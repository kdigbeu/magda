import "./Search.css";
import { connect } from "react-redux";
import { Redirect } from "react-router-dom";
import { config } from "../../config";
import defined from "../../helpers/defined";
import Pagination from "../../UI/Pagination";
import Notification from "../../UI/Notification";
import ReactDocumentTitle from "react-document-title";
import React, { Component } from "react";
import SearchFacets from "../../Components/SearchFacets/SearchFacets";
import SearchResults from "../SearchResults/SearchResults";
import MatchingStatus from "./MatchingStatus";
import { bindActionCreators } from "redux";
import {
    fetchSearchResultsIfNeeded,
    resetDatasetSearch
} from "../../actions/datasetSearchActions";
import queryString from "query-string";
import ProgressBar from "../../UI/ProgressBar";

// eslint-disable-next-line
import PropTypes from "prop-types";

class Search extends Component {
    state: {
        searchText: ?string
    };

    constructor(props) {
        super(props);
        const self: any = this;

        self.onClickTag = this.onClickTag.bind(this);
        self.updateQuery = this.updateQuery.bind(this);
        self.onDismissError = this.onDismissError.bind(this);
        self.updateSearchText = this.updateSearchText.bind(this);
        self.onToggleDataset = this.onToggleDataset.bind(this);
        self.onPageChange = this.onPageChange.bind(this);
        // it needs to be undefined here, so the default value should be from the url
        // once this value is set, the value should always be from the user input
        this.state = {
            searchText: undefined,
            filterCount: 0
        };
    }

    componentWillMount() {
        this.props.resetDatasetSearch();
        this.props.fetchSearchResultsIfNeeded(
            queryString.parse(this.props.location.search)
        );
    }

    componentWillReceiveProps(nextProps) {
        nextProps.fetchSearchResultsIfNeeded(
            queryString.parse(nextProps.location.search)
        );
    }

    componentWillUnmount() {
        this.props.resetDatasetSearch();
    }

    onClickTag(tag: string) {
        this.setState({
            searchText: tag
        });
        this.updateSearchText(tag);
    }

    /**
     * update only the search text, remove all facets
     */
    updateSearchText(text: string) {
        this.updateQuery({
            q: text,
            publisher: [],
            regionId: undefined,
            regionType: undefined,
            dateFrom: undefined,
            dateTo: undefined,
            format: [],
            page: undefined
        });
    }

    /**
     * query in this case, is one or more of the params
     * eg: {'q': 'water'}
     */
    updateQuery(query) {
        this.context.router.history.push({
            pathname: this.props.location.pathname,
            search: queryString.stringify(
                Object.assign(
                    queryString.parse(this.props.location.search),
                    query
                )
            )
        });
    }

    onDismissError() {
        // remove all current configurations
        this.updateSearchText("");
        this.props.resetDatasetSearch();
    }

    onToggleDataset(datasetIdentifier) {
        this.updateQuery({
            open:
                datasetIdentifier ===
                queryString.parse(this.props.location.search).open
                    ? ""
                    : datasetIdentifier
        });
    }

    searchBoxEmpty() {
        return (
            !defined(queryString.parse(this.props.location.search).q) ||
            queryString.parse(this.props.location.search).q.length === 0
        );
    }

    onPageChange(i) {
        this.context.router.history.push({
            pathname: this.props.location.pathname,
            search: queryString.stringify(
                Object.assign(queryString.parse(this.props.location.search), {
                    page: i
                })
            )
        });
    }

    filterCount = () => {
        var count = 0;
        if (this.props.activePublishers.length > 0) {
            count++;
        }
        if (this.props.activeFormats.length > 0) {
            count++;
        }

        if (this.props.activeRegion.regionId) {
            count++;
        }

        if (this.props.activeDateFrom) {
            count++;
        }
        if (count != 0) {
            var filterText = count === 1 ? " filter" : " filters";
            return " with " + count + filterText;
        } else {
            return "";
        }
    };

    render() {
        const searchText =
            queryString.parse(this.props.location.search).q || "";
        return (
            <ReactDocumentTitle
                title={`Searching for ${searchText} | ${config.appName}`}
            >
                <div>
                    {this.props.isFetching && <ProgressBar />}
                    <div className="search">
                        <div className="search__search-body">
                            <SearchFacets
                                updateQuery={this.updateQuery}
                                location={this.props.location}
                            />
                            {!this.props.isFetching &&
                                !this.props.error && (
                                    <div className="sub-heading">
                                        {" "}
                                        results {this.filterCount()} ({
                                            this.props.hitCount
                                        }
                                        )
                                    </div>
                                )}
                            {!this.props.isFetching &&
                                !this.props.error && (
                                    <div>
                                        {!this.searchBoxEmpty() && (
                                            <MatchingStatus
                                                datasets={this.props.datasets}
                                                strategy={this.props.strategy}
                                            />
                                        )}

                                        {// redirect if we came from a 404 error and there is only one result
                                        queryString.parse(
                                            this.props.location.search
                                        ).notfound &&
                                            this.props.datasets.length ===
                                                1 && (
                                                <Redirect
                                                    to={`/dataset/${encodeURI(
                                                        this.props.datasets[0]
                                                            .identifier
                                                    )}/details`}
                                                />
                                            )}
                                        <SearchResults
                                            strategy={this.props.strategy}
                                            searchResults={this.props.datasets}
                                            onClickTag={this.onClickTag}
                                            onToggleDataset={
                                                this.onToggleDataset
                                            }
                                            openDataset={
                                                queryString.parse(
                                                    this.props.location.search
                                                ).open
                                            }
                                            searchText={searchText}
                                        />
                                        {this.props.hitCount >
                                            config.resultsPerPage && (
                                            <Pagination
                                                currentPage={
                                                    +queryString.parse(
                                                        this.props.location
                                                            .search
                                                    ).page || 1
                                                }
                                                maxPage={Math.ceil(
                                                    this.props.hitCount /
                                                        config.resultsPerPage
                                                )}
                                                onPageChange={this.onPageChange}
                                                totalItems={this.props.hitCount}
                                            />
                                        )}
                                    </div>
                                )}
                            {!this.props.isFetching &&
                                this.props.error && (
                                    <Notification
                                        content={this.props.error}
                                        type="error"
                                        onDismiss={this.onDismissError}
                                    />
                                )}
                        </div>
                    </div>
                </div>
            </ReactDocumentTitle>
        );
    }
}

Search.contextTypes = {
    router: PropTypes.object.isRequired
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            fetchSearchResultsIfNeeded: fetchSearchResultsIfNeeded,
            resetDatasetSearch: resetDatasetSearch
        },
        dispatch
    );

function mapStateToProps(state, ownProps) {
    let { datasetSearch } = state;
    return {
        datasets: datasetSearch.datasets,
        activeFormats: datasetSearch.activeFormats,
        activePublishers: datasetSearch.activePublishers,
        activeRegion: datasetSearch.activeRegion,
        activeDateFrom: datasetSearch.activeDateFrom,
        hitCount: datasetSearch.hitCount,
        isFetching: datasetSearch.isFetching,
        progress: datasetSearch.progress,
        strategy: datasetSearch.strategy,
        error: datasetSearch.error,
        freeText: datasetSearch.freeText
    };
}

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(Search);
