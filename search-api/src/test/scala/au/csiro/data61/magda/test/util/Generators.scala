package au.csiro.data61.magda.test.util

import java.time.Duration
import java.time.temporal.ChronoUnit

import org.scalacheck.{ Gen, Shrink }
import org.scalacheck.Gen.Choose._
import org.scalacheck.Arbitrary._
import com.monsanto.labs.mwundo.GeoJson._
import au.csiro.data61.magda.model.misc._
import au.csiro.data61.magda.model.temporal._
import java.time.ZonedDateTime

import com.fortysevendeg.scalacheck.datetime.instances.jdk8._
import com.fortysevendeg.scalacheck.datetime.GenDateTime.genDateTimeWithinRange
import java.time.ZoneOffset

import com.vividsolutions.jts.geom
import com.vividsolutions.jts.operation.valid.IsValidOp
import java.time.Instant

import akka.http.scaladsl.model.MediaTypes
import au.csiro.data61.magda.search.elasticsearch.ElasticSearchIndexer
import au.csiro.data61.magda.search.elasticsearch.ElasticSearchIndexer
import java.util.concurrent.atomic.AtomicInteger

import akka.http.scaladsl.server.Route
import au.csiro.data61.magda.api.Query
import au.csiro.data61.magda.util.Regex._
import org.scalacheck.Shrink.shrink
import au.csiro.data61.magda.spatial.RegionSource
import spray.json.JsObject
import java.net.URL
import spray.json._
import au.csiro.data61.magda.model.misc.Protocols._

object Generators {
  val LUCENE_CONTROL_CHARACTER_REGEX = "[.,\\/#!$%\\^&\\*;:{}=\\-_`~()\\[\\]\"'\\+]".r
  def someBiasedOption[T](inner: Gen[T]) = Gen.frequency((4, Gen.some(inner)), (1, None))
  def noneBiasedOption[T](inner: Gen[T]) = Gen.frequency((1, Gen.some(inner)), (20, None))

  val defaultStartTime = ZonedDateTime.parse("1850-01-01T00:00:00Z").toInstant
  val defaultTightStartTime = ZonedDateTime.parse("2000-01-01T00:00:00Z").toInstant
  val defaultEndTime = ZonedDateTime.parse("2020-01-01T00:00:00Z").toInstant
  val defaultTightEndTime = ZonedDateTime.parse("2015-01-01T00:00:00Z").toInstant

  def genInstant(start: Instant, end: Instant) =
    Gen.choose(start.toEpochMilli(), end.toEpochMilli())
      .flatMap(Instant.ofEpochMilli(_))

  def offsetDateTimeGen(start: Instant = defaultStartTime, end: Instant = defaultEndTime) = for {
    dateTime <- genInstant(start, end)
    offsetHours <- Gen.chooseNum(-17, 17)
    offsetMinutes <- Gen.chooseNum(0, 59).map(_ * offsetHours.signum)
    offsetSeconds <- Gen.chooseNum(0, 59).map(_ * offsetHours.signum)
  } yield dateTime.atOffset(
    ZoneOffset.ofHoursMinutesSeconds(offsetHours, offsetMinutes, offsetSeconds)
  )

  def apiDateGen(start: Instant, end: Instant) = for {
    date <- someBiasedOption(offsetDateTimeGen(start, end))
    text <- if (date.isDefined) Gen.const(date.get.toString) else arbitrary[String]
  } yield ApiDate(date, text)

  val periodOfTimeGen = (for {
    startTime <- Gen.frequency((9, Gen.const(defaultTightStartTime)), (1, defaultStartTime))
    endTime <- Gen.frequency((9, Gen.const(defaultTightEndTime)), (1, defaultEndTime))
    start <- someBiasedOption(apiDateGen(startTime, endTime))
    end <- someBiasedOption(apiDateGen(start.flatMap(_.date).map(_.toInstant).getOrElse(startTime), endTime))
  } yield new PeriodOfTime(start, end)).suchThat {
    case PeriodOfTime(Some(ApiDate(Some(start), _)), Some(ApiDate(Some(end), _))) => start.isBefore(end)
    case _ => true
  }

  def agentGen(nameGen: Gen[String]) = for {
    name <- someBiasedOption(nameGen)
    homePage <- someBiasedOption(arbitrary[String])
    email <- someBiasedOption(arbitrary[String])
    //    extraFields <- Gen.mapOf(Gen.zip(keyGen, arbitrary[String]))
  } yield new Agent(name, homePage, email)

  val durationGen = for {
    number <- Gen.chooseNum(0l, 100l)
    unit <- Gen.oneOf(ChronoUnit.DAYS, ChronoUnit.HOURS, ChronoUnit.MINUTES)
  } yield Duration.of(number, unit)

  val periodicityGen = for {
    text <- someBiasedOption(arbitrary[String])
    duration <- someBiasedOption(durationGen)
  } yield Periodicity(text, duration)

  val xGen =
    Gen.chooseNum(-180, 180).map(BigDecimal.apply)

  val yGen =
    Gen.chooseNum(-90, 90).map(BigDecimal.apply)

  val coordGen = for {
    x <- xGen
    y <- yGen
  } yield Coordinate(x, y)

  def nonConsecutiveDuplicates[T](min: Int, max: Int, gen: Gen[T]) = listSizeBetween(min, max, gen)
    .suchThat(list => list.sliding(2).forall {
      case Seq(before, after) => !before.equals(after)
    })

  val regionSourceGenInner = for {
    name <- Gen.alphaNumStr
    idProperty <- Gen.alphaNumStr
    nameProperty <- Gen.alphaNumStr
    includeIdInName <- arbitrary[Boolean]
    order <- Gen.posNum[Int]
  } yield RegionSource(
    name = name,
    url = new URL("http://example.com"),
    idProperty = idProperty,
    nameProperty = nameProperty,
    includeIdInName = includeIdInName,
    disabled = false,
    order = order
  )

  val regionSourceGen = cachedListGen(regionSourceGenInner, 1)

  val regionGen = for {
    regionSource <- regionSourceGen.flatMap(Gen.oneOf(_))
    id <- Gen.alphaNumStr
    name <- Gen.alphaNumStr
    geometry <- geometryGen
    order <- Gen.posNum[Int]
  } yield (regionSource, JsObject(
    "type" -> JsString("Feature"),
    "geometry" -> GeometryFormat.write(geometry),
    "order" -> JsNumber(order),
    "properties" -> JsObject(
      regionSource.idProperty -> JsString(id),
      regionSource.nameProperty -> JsString(name)
    )
  ))

  val indexedRegionsGen = cachedListGen(regionGen, 1)

  def listSizeBetween[T](min: Int, max: Int, gen: Gen[T]) = Gen.chooseNum(min, max)
    .flatMap(x => Gen.listOfN(x, gen))

  val pointGen = coordGen.map(Point.apply)
  val multiPointGen = listSizeBetween(1, 10, coordGen).map(MultiPoint.apply)
  val lineStringGenInner = nonConsecutiveDuplicates(2, 5, coordGen)
  val lineStringGen = lineStringGenInner.map(LineString.apply)
  val multiLineStringGen = listSizeBetween(1, 10, lineStringGenInner)
    .map(MultiLineString.apply)
  val polygonGenInner = listSizeBetween(3, 10, Gen.zip(Gen.choose(1, 90)))
    .map(_.sorted)
    .map(list => list.zipWithIndex.map {
      case (hypotenuse, index) =>
        val angle = (Math.PI / list.size) * (index + 1)
        Coordinate(hypotenuse * Math.cos(angle), hypotenuse * Math.sin(angle))
    })
    .map(x => x :+ x.head)
  val polygonStringGen = Gen.listOfN(1, polygonGenInner) // FIXME: Do we need a hole generator?
    .map(Polygon.apply)
  val multiPolygonStringGen =
    Gen.chooseNum(1, 5).flatMap(Gen.listOfN(_, polygonStringGen.map(_.coordinates)))
      .map(MultiPolygon.apply)

  val geometryGen = Gen.oneOf(
    pointGen,
    multiPointGen,
    lineStringGen,
    multiLineStringGen,
    polygonStringGen,
    multiPolygonStringGen
  )

  val locationGen = for {
    text <- someBiasedOption(Gen.alphaNumStr)
    geoJson <- someBiasedOption(geometryGen)
  } yield new Location(text, geoJson)

  val nonEmptyString = Gen.choose(1, 20).flatMap(Gen.listOfN(_, Gen.alphaNumChar).map(_.mkString))

  def cachedListGen[T](gen: Gen[T], size: Int) = {
    var cache: Option[List[T]] = None

    Gen.delay {
      cache match {
        case Some(cacheInner) =>
          Gen.const(cacheInner)
        case None =>
          Gen.listOfN(size, gen).map { words =>
            cache = Some(words)
            words
          }
      }
    }
  }

  val descWordGen = cachedListGen(nonEmptyString, 1000)
  val publisherGen = cachedListGen(nonEmptyString, 50)
  val mediaTypeGen = Gen.oneOf(Seq(
    MediaTypes.`application/json`,
    MediaTypes.`application/vnd.google-earth.kml+xml`,
    MediaTypes.`text/csv`,
    MediaTypes.`application/json`,
    MediaTypes.`application/octet-stream`
  ))
  val randomFormatGen = cachedListGen(nonEmptyString, 50)

  def textGen(inner: Gen[List[String]]) = inner
    .flatMap(Gen.someOf(_))
    .map {
      case Nil => ""
      case seq => seq.reduce(_ + " " + _)
    }

  val licenseGen = for {
    name <- someBiasedOption(arbitrary[String])
    url <- someBiasedOption(arbitrary[String])
  } yield License(name, url)

  val formatGen = for {
    mediaType <- Gen.option(mediaTypeGen)
    randomFormat <- randomFormatGen.flatMap(Gen.oneOf(_))
  } yield (mediaType, mediaType.flatMap(_.fileExtensions.headOption).getOrElse(randomFormat))

  val distGen = for {
    title <- arbitrary[String]
    description <- someBiasedOption(arbitrary[String])
    issued <- someBiasedOption(offsetDateTimeGen())
    modified <- someBiasedOption(offsetDateTimeGen())
    license <- someBiasedOption(licenseGen)
    rights <- someBiasedOption(arbitrary[String])
    accessURL <- someBiasedOption(arbitrary[String])
    byteSize <- someBiasedOption(arbitrary[Int])
    format <- someBiasedOption(formatGen)
  } yield Distribution(
    title = title,
    description = description,
    issued = issued,
    modified = modified,
    license = license,
    rights = rights,
    accessURL = accessURL,
    byteSize = byteSize,
    mediaType = format.flatMap(_._1),
    format = format.map(_._2)
  )

  val incrementer: AtomicInteger = new AtomicInteger(0)

  val dataSetGen = for {
    identifier <- Gen.delay {
      incrementer.incrementAndGet()
    }
    title <- someBiasedOption(Gen.alphaNumStr)
    catalog <- arbitrary[String]
    description <- someBiasedOption(textGen(descWordGen))
    issued <- someBiasedOption(offsetDateTimeGen())
    modified <- someBiasedOption(offsetDateTimeGen())
    language <- someBiasedOption(arbitrary[String])
    publisher <- someBiasedOption(agentGen(publisherGen.flatMap(Gen.oneOf(_))))
    accrualPeriodicity <- someBiasedOption(periodicityGen)
    spatial <- Gen.option(locationGen)
    temporal <- someBiasedOption(periodOfTimeGen)
    theme <- Gen.listOf(arbitrary[String])
    keyword <- Gen.listOf(arbitrary[String])
    contactPoint <- someBiasedOption(agentGen(arbitrary[String]))
    distributions <- Gen.choose(1, 5).flatMap(size => Gen.listOfN(size, distGen)) //.map(_.groupBy(_.format).mapValues(_.head).values.toList)//.map(distributions => distributions.map(_.copy(format = distributions.head.format)))
    landingPage <- someBiasedOption(arbitrary[String])
  } yield DataSet(
    identifier = identifier.toString,
    catalog = catalog,
    title = title,
    description = description,
    issued = issued,
    modified = modified,
    language = language,
    publisher = publisher,
    accrualPeriodicity = accrualPeriodicity,
    //    spatial = spatial,
    temporal = temporal,
    theme = theme,
    keyword = keyword,
    contactPoint = contactPoint,
    distributions = distributions,
    landingPage = landingPage,
    years = ElasticSearchIndexer.getYears(temporal.flatMap(_.start.flatMap(_.date)), temporal.flatMap(_.end.flatMap(_.date)))
  )

  val queryTextGen = descWordGen.flatMap(descWords => Gen.choose(1, 5).flatMap(size => Gen.pick(size, descWords))).map(_.mkString(" ")).map(removeFilters)

  def set[T](gen: Gen[T]): Gen[Set[T]] = Gen.containerOf[Set, T](gen)
  def probablyEmptySet[T](gen: Gen[T]): Gen[Set[T]] = Gen.frequency((1, Gen.nonEmptyContainerOf[Set, T](gen)), (3, Gen.const(Set())))
  def smallSet[T](gen: Gen[T]): Gen[Set[T]] = probablyEmptySet(gen).flatMap(set => Gen.pick(set.size % 3, set)).map(_.toSet)

  val partialFormatGen = formatGen.map(_._2).flatMap(format => Gen.choose(format.length / 2, format.length).map(length => format.substring(Math.min(format.length - 1, length))))
  val formatQueryGen = Gen.frequency((5, formatGen.map(_._2)), (3, partialFormatGen), (1, nonEmptyString)).map(removeFilters)

  val partialPublisherGen = publisherGen.flatMap(Gen.oneOf(_)).flatMap { publisher =>
    Gen.choose(publisher.length / 2, publisher.length).map(length => publisher.substring(Math.min(publisher.length - 1, length)))
  }
  val publisherQueryGen = Gen.frequency((5, publisherGen.flatMap(Gen.oneOf(_))), (3, partialPublisherGen), (1, nonEmptyString)).map(removeFilters)
  val regionQueryGen: Gen[QueryRegion] = indexedRegionsGen.flatMap(Gen.oneOf(_)).map {
    case (regionSource, regionObject) => QueryRegion(
      regionType = regionSource.name,
      regionId = regionObject.fields("properties").asJsObject.fields(regionSource.idProperty).asInstanceOf[JsString].value
    )
  }

  val queryGen = (for {
    freeText <- Gen.option(queryTextGen)
    quotes <- probablyEmptySet(queryTextGen)
    publishers <- probablyEmptySet(publisherQueryGen)
    dateFrom <- Gen.option(periodOfTimeGen.map(_.start.flatMap(_.date)))
    dateTo <- Gen.option(periodOfTimeGen.map(_.end.flatMap(_.date)))
    formats <- probablyEmptySet(formatQueryGen)
    regions <- probablyEmptySet(regionQueryGen)
  } yield Query(
    freeText = freeText,
    quotes = quotes,
    publishers = publishers,
    dateFrom = dateFrom.flatten,
    dateTo = dateTo.flatten,
    formats = formats,
    regions = regions
  )).map(removeInvalid)

  val exactQueryGen = (for {
    freeText <- Gen.option(queryTextGen)
    quotes <- probablyEmptySet(queryTextGen)
    publishers <- publisherGen.flatMap(Gen.someOf(_)).map(_.toSet)
    dateFrom <- Gen.option(periodOfTimeGen.map(_.start.flatMap(_.date)))
    dateTo <- Gen.option(periodOfTimeGen.map(_.end.flatMap(_.date)))
    formats <- probablyEmptySet(formatGen.map(_._2))
    regions <- probablyEmptySet(regionQueryGen)
  } yield Query(
    freeText = freeText,
    quotes = quotes,
    publishers = publishers,
    dateFrom = dateFrom.flatten,
    dateTo = dateTo.flatten,
    formats = formats,
    regions = regions
  )).map(removeInvalid)

  val specificBiasedQueryGen = (for {
    publishers <- Gen.nonEmptyContainerOf[Set, String](publisherQueryGen)
    formats <- Gen.nonEmptyContainerOf[Set, String](formatQueryGen)
  } yield Query(
    publishers = publishers,
    formats = formats
  )).map(removeInvalid)

  val unspecificQueryGen = (for {
    freeText <- noneBiasedOption(queryTextGen)
    quotes <- smallSet(queryTextGen)
    publishers <- smallSet(publisherQueryGen)
    dateFrom <- noneBiasedOption(periodOfTimeGen.map(_.start.flatMap(_.date)))
    dateTo <- noneBiasedOption(periodOfTimeGen.map(_.end.flatMap(_.date)))
    formats <- smallSet(formatQueryGen)
    regions <- smallSet(regionQueryGen)
  } yield Query(
    freeText = freeText,
    quotes = quotes,
    publishers = publishers,
    dateFrom = dateFrom.flatten,
    dateTo = dateTo.flatten,
    formats = formats,
    regions = regions
  ))
    .flatMap(query => if (query.equals(Query())) for { freeText <- queryTextGen } yield Query(Some(freeText)) else Gen.const(query))
    .map(removeInvalid)

  val suggestedFacetQueryGen = (for {
    publishers <- publisherGen.flatMap(Gen.someOf(_)).map(_.toSet)
    formats <- smallSet(formatGen.map(_._2))
  } yield Query(
    publishers = publishers,
    formats = formats
  ))
    .flatMap(query => if (query.equals(Query())) for { freeText <- queryTextGen } yield Query(Some(freeText)) else Gen.const(query))
    .map(removeInvalid)
    .flatMap(query => query.copy(
      freeText = Some(query.freeText.getOrElse("") + " " + query.formats.map("-" + _).mkString(" "))
    ))

  val filterRegex = "(\"|by|to|from|as|in)".r

  def removeFilters(string: String) = filterRegex.replaceAllIn(string, "a" + string)

  def noFilters(string: String): Boolean = !filterRegex.matchesAny(string)

  def noFiltersInFreeText(query: Query): Boolean = {
    query.productIterator.forall {
      case (x: String)    ⇒ noFilters(x)
      case (Some(x))      ⇒ noFilters(x.toString)
      case (xs: Set[Any]) ⇒ xs.forall(y ⇒ noFilters(y.toString))
      case _              ⇒ true
    }
  }
  def removeInvalid(objQuery: Query): Query = {
    objQuery.copy(
      freeText = objQuery.freeText.map(LUCENE_CONTROL_CHARACTER_REGEX.replaceAllIn(_, "")),
      quotes = objQuery.quotes.map(LUCENE_CONTROL_CHARACTER_REGEX.replaceAllIn(_, "")),
      formats = objQuery.formats.map(LUCENE_CONTROL_CHARACTER_REGEX.replaceAllIn(_, "")),
      publishers = objQuery.publishers.map(LUCENE_CONTROL_CHARACTER_REGEX.replaceAllIn(_, ""))
    )
  }

  def textQueryGen(queryGen: Gen[Query] = queryGen): Gen[(String, Query)] = queryGen.flatMap { query =>
    val textList = (Seq(query.freeText).flatten ++
      query.quotes.map(""""""" + _ + """"""")).toSet
    val facetList = query.publishers.map(publisher => s"by $publisher") ++
      Seq(query.dateFrom.map(dateFrom => s"from $dateFrom")).flatten ++
      Seq(query.dateTo.map(dateTo => s"to $dateTo")).flatten ++
      query.formats.map(format => s"as $format") ++
      query.regions.map(region => s"in ${region.regionType}:${region.regionId}")

    Gen.pick(textList.size, textList)
      .flatMap(existingList => Gen.pick(facetList.size, facetList).map(existingList ++ _))
      .map(queryStringList => (queryStringList.mkString(" "), query))
  }

}