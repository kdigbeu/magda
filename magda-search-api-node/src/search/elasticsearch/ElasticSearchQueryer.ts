import { Client, ApiResponse } from "@elastic/elasticsearch";
import _ = require("lodash");

import {
    Query,
    FacetType,
    FacetSearchResult,
    Region,
    FacetOption,
    SearchResult,
    ISODate
} from "../../model";
import SearchQueryer from "../SearchQueryer";
import getFacetDefinition from "./getFacetDefinition";

const client = new Client({ node: "http://localhost:9200" });

type LanguageField = {
    path: string;
    boost?: number;
};

const DATASETS_LANGUAGE_FIELDS: LanguageField[] = [
    { path: "title", boost: 50 },
    { path: "description", boost: 2 },
    { path: "publisher.name" },
    { path: "keywords", boost: 10 },
    { path: "themes" }
];
const NON_LANGUAGE_FIELDS: LanguageField[] = [
    { path: "_id" },
    { path: "catalog" },
    { path: "accrualPeriodicity" },
    { path: "contactPoint.identifier" },
    { path: "publisher.acronym" }
];

export default class ElasticSearchQueryer implements SearchQueryer {
    constructor(
        readonly datasetsIndexId: string,
        readonly regionsIndexId: string,
        readonly publishersIndexId: string
    ) {}

    async searchFacets(
        facetType: FacetType,
        generalQuery: Query,
        start: number,
        limit: number,
        facetQuery: string | undefined
    ): Promise<FacetSearchResult> {
        const facetDef = getFacetDefinition(facetType);

        const esQueryBody = {
            index: this.publishersIndexId,
            body: {
                query: {
                    dis_max: {
                        tie_breaker: 0,
                        queries: [
                            {
                                match_phrase_prefix: {
                                    value: facetQuery || ""
                                }
                            },
                            {
                                match_phrase_prefix: {
                                    acronym: facetQuery || ""
                                }
                            }
                        ]
                    }
                }
            },
            size: limit,
            from: start
        };
        // console.log(JSON.stringify(esQueryBody, null, 2));

        const result: ApiResponse = await client.search(esQueryBody);

        const { body } = result;

        if (body.totalHits === 0) {
            return { hitCount: 0, options: [] };
        } else {
            type Hit = {
                value: string;
                identifier?: string;
            };

            const hits: Hit[] = body.hits.hits.map((hit: any) => hit._source);

            // Create a dataset filter aggregation for each hit in the initial query
            const filters = hits.reduce(
                (soFar: any, { value }: Hit) => ({
                    ...soFar,
                    [value]: {
                        filter: facetDef.exactMatchQuery(value)
                    }
                }),
                {}
            );

            // Do a datasets query WITHOUT filtering for this facet and  with an aggregation for each of the hits we
            // got back on our keyword - this allows us to get an accurate count of dataset hits for each result
            const generalEsQueryBody = {
                from: 0,
                size: 0,
                body: {
                    query: await this.buildESDatasetsQuery(
                        facetDef.removeFromQuery(generalQuery)
                    ),
                    aggs: filters
                },
                index: this.datasetsIndexId
            };
            const resultWithout = await client.search(generalEsQueryBody);

            const aggregationsResult = _(resultWithout.body.aggregations as {
                [aggName: string]: any;
            })
                .map((value, key) => ({
                    countErrorUpperBound: 0,
                    hitCount: value.doc_count || 0,
                    matched: false,
                    value: key
                }))
                .keyBy("value")
                .value();

            const options: FacetOption[] = _(hits)
                .map(hit => ({
                    ...aggregationsResult[hit.value],
                    identifier: hit.identifier
                }))
                .sortBy(hit => -hit.hitCount)
                .drop(start)
                .take(limit)
                .value();

            return {
                hitCount: resultWithout.body.hits.total,
                options
            };
        }
    }

    async search(
        query: Query,
        start: number,
        limit: number,
        facetSize: number
    ): Promise<SearchResult> {
        const searchParams = {
            from: start,
            size: limit,
            body: {
                query: await this.buildESDatasetsQuery(query)
                // aggs: filters
            },
            index: this.datasetsIndexId
        };

        // For debugging! Use this to explain how a certain dataset is rated.
        // console.log(
        //     JSON.stringify(
        //         (await client.explain({
        //             body: {
        //                 query: await this.buildESDatasetsQuery(query)
        //                 // aggs: filters
        //             },
        //             index: this.datasetsIndexId,
        //             id: "ds-6",
        //             type: "datasets"
        //         })).body,
        //         null,
        //         2
        //     )
        // );
        const response: ApiResponse = await client.search(searchParams);

        return {
            query,
            hitCount: response.body.hits.total,
            datasets: response.body.hits.hits.map((hit: any) => ({
                ...hit._source,
                score: hit._score,
                years: undefined
            })),
            temporal: {
                start: {
                    date: new Date().toISOString(), //TODO
                    text: new Date().toString()
                },
                end: {
                    date: new Date().toISOString(), //TODO
                    text: new Date().toString()
                }
            },
            facets: [],
            strategy: "match-all"
        };
    }

    async getBoostRegions(query: Query): Promise<Region[]> {
        if (!query.freeText || query.freeText === "") {
            return [];
        }

        const regionsResult = await client.search({
            index: this.regionsIndexId,
            body: {
                query: {
                    match: {
                        regionSearchId: {
                            query: query.freeText,
                            operator: "or"
                        }
                    }
                }
            },
            size: 50
        });

        return regionsResult.body.hits.hits.map((x: any) => x._source);
    }

    async buildESDatasetsQuery(query: Query): Promise<any> {
        const boostRegions = await this.getBoostRegions(query);

        const geomScorerQueries = boostRegions.map(
            this.regionToGeoshapeQuery,
            this
        );

        const qualityFactor = {
            filter: {
                term: {
                    hasQuality: true
                }
            },
            field_value_factor: {
                field: "quality",
                missing: 1
            }
        };

        const esQuery = {
            function_score: {
                query: this.queryToEsQuery(query, boostRegions),
                functions: [
                    {
                        weight: 1
                    },
                    qualityFactor,
                    {
                        filter: {
                            bool: {
                                should: geomScorerQueries
                            }
                        },
                        weight: 1
                    }
                ],
                score_mode: "sum"
            }
        };

        return esQuery;
    }

    queryToEsQuery(query: Query, boostRegions: Region[]): any {
        const freeText = (() => {
            const sanitisedFreeText =
                !query.freeText || query.freeText === "" ? "*" : query.freeText;
            const textQuery = this.textQuery(sanitisedFreeText);

            if (boostRegions.length === 0) {
                return textQuery;
            } else {
                const regionNames = _(boostRegions)
                    .flatMap(region => [
                        region.regionName,
                        region.regionShortName
                    ])
                    .filter(x => x && x !== "")
                    .sortBy(a => a.length)
                    .value();

                // Remove these regions from the text
                const textWithoutRegions = regionNames
                    .reduce(
                        (soFar, currentRegion) =>
                            soFar.replace(new RegExp(currentRegion, "ig"), ""),
                        sanitisedFreeText
                    )
                    .trim();

                const textQueryNoRegions = this.textQuery(
                    textWithoutRegions.length > 0 ? textWithoutRegions : "*"
                );
                const geomScorerQueries = boostRegions.map(
                    this.regionToGeoshapeQuery,
                    this
                );

                return {
                    bool: {
                        should: [
                            textQuery,
                            {
                                bool: {
                                    must: [
                                        textQueryNoRegions,
                                        ...geomScorerQueries
                                    ]
                                }
                            }
                        ],
                        minimum_should_match: 1
                    }
                };
            }
        })();

        const dateQuery = (date: ISODate, comparator: "gte" | "lte") => ({
            bool: {
                should: [
                    {
                        range: {
                            "temporal.end.date": {
                                [comparator]: date
                            }
                        }
                    },
                    {
                        range: {
                            "temporal.start.date": {
                                [comparator]: date
                            }
                        }
                    }
                ],
                minimum_should_match: 1
            }
        });

        return {
            bool: {
                must: [
                    freeText,
                    ...query.regions.map(queryRegion =>
                        this.regionIdToGeoshapeQuery(
                            queryRegion.regionType + "/" + queryRegion.regionId
                        )
                    ),
                    query.dateFrom &&
                        dateQuery(query.dateFrom.toISOString(), "gte"),
                    query.dateTo && dateQuery(query.dateTo.toISOString(), "lte")
                ].filter(x => !!x)
            }
        };
    }

    textQuery(inputText: string) {
        const simpleQueryStringQuery = {
            query: inputText,
            default_operator: "and",
            quote_field_suffix: ".quote"
        };

        // Surprise! english analysis doesn't work on nested objects unless you have a nested query, even though
        // other analysis does. So we do this silliness
        const distributionsEnglishQuery = {
            nested: {
                path: "distributions",
                score_mode: "max",
                query: {
                    simple_query_string: {
                        query: inputText,
                        fields: [
                            "distributions.title",
                            "distributions.description",
                            "distributions.format"
                        ],
                        default_operator: "and"
                    }
                }
            }
        };

        /**
         * Unfortunately, when default operator is AND, we can't put NON_LANGUAGE_FIELDS & DATASETS_LANGUAGE_FIELDS
         * into one SimpleStringQuery as they have different searchAnalylzer
         * It will result a term like +(catalog:at | _id:at)  will never be matched
         * We need to fix on our side as elasticsearch won't know our intention for this case
         */
        const queries = [
            {
                bool: {
                    should: [
                        {
                            simple_query_string: {
                                ...simpleQueryStringQuery,
                                fields: DATASETS_LANGUAGE_FIELDS.map(
                                    fieldDefToEs
                                )
                            }
                        },
                        {
                            simple_query_string: {
                                ...simpleQueryStringQuery,
                                fields: NON_LANGUAGE_FIELDS.map(fieldDefToEs)
                            }
                        }
                    ],
                    minimum_should_match: 1
                }
            },
            distributionsEnglishQuery
        ];

        return {
            dis_max: {
                queries
            }
        };
    }

    regionToGeoshapeQuery(region: Region) {
        return this.regionIdToGeoshapeQuery(region.regionSearchId);
    }

    regionIdToGeoshapeQuery(id: string) {
        return {
            geo_shape: {
                "spatial.geoJson": {
                    indexed_shape: {
                        index: this.regionsIndexId,
                        type: "regions",
                        id,
                        path: "geometry"
                    }
                }
            }
        };
    }
}

function fieldDefToEs(def: LanguageField): string {
    if (typeof def.boost !== "undefined") {
        return `${def.path}^${def.boost}`;
    } else {
        return def.path;
    }
}
