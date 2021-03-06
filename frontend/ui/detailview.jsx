import percentile from 'aggregatejs/percentile';
import React from 'react';
import _ from 'lodash';
import moment from 'moment';
import { Button, FormGroup, Input, Label, Modal, ModalBody, ModalHeader, ModalFooter, Row, Col, Container } from 'reactstrap';
import { Helmet } from 'react-helmet';
import { connect } from 'react-redux';
import Loading from './loading.jsx';
import MeasureGraph from './measuregraph.jsx';
import SubViewNav from './subviewnav.jsx';
import { DEFAULT_TIME_INTERVAL, TIME_INTERVALS, DEFAULT_PERCENTILE, PERCENTILES, DEFAULT_VERSION_GROUPING_TYPE } from '../schema';

const mapStateToProps = (state, ownProps) => {
  const measure = ownProps.match.params.measure;
  const cacheKey = `${ownProps.match.params.platform}-${ownProps.match.params.channel}-${measure}`;
  const measureData = state.measures[cacheKey];

  return { measureData };
};

const getTransformedSeriesList = (seriesList, measure, normalized, percentileThreshold) => {
  let newSeriesList = seriesList;

  if (normalized) {
    newSeriesList = newSeriesList.map(series => ({
      ...series,
      data: series.data.map(d => ({
        ...d,
        [measure]: d[measure] / (d.usage_hours / 1000.0)
      }))
    }));
  }
  if (percentileThreshold < 100) {
    newSeriesList = newSeriesList.map((series) => {
      const threshold = percentile(series.data.map(d => d[measure]),
                                   percentileThreshold / 100.0);
      return {
        ...series,
        data: series.data.filter(d => d[measure] < threshold)
      };
    });
  }

  return newSeriesList;
};

const getDateString = (date) => {
  // input could be either a javascript date object or undefined
  if (!date) return '';
  return date.toISOString().slice(0, 10);
};

const getValidTimeIntervals = (params) => {
  const timeIntervals = _.clone(TIME_INTERVALS);
  if (params.startTime) {
    const startTimeMs = parseInt(params.startTime * 1000.0, 10);
    const [startDateStr, endDateStr] = [startTimeMs, startTimeMs + (params.timeInterval * 1000)].map(
      time => moment(time).format('ddd MMM D'));
    timeIntervals.unshift({
      label: `${startDateStr} → ${endDateStr}`,
      startTime: params.startTime,
      interval: params.timeInterval
    });
  }

  return timeIntervals;
};

const getOptionalParameters = (props) => {
  const urlParams = new URLSearchParams(props.location.search);

  // time interval can either be specified as an interval (starting from the present) or a set of dates
  const timeInterval = parseInt(
    urlParams.get('timeInterval') ? urlParams.get('timeInterval') : DEFAULT_TIME_INTERVAL, 10);

  let startTime = urlParams.get('startTime');
  let customStartDate;
  let customEndDate;
  if (startTime) {
    startTime = parseInt(startTime, 10);
    customStartDate = new Date(startTime * 1000);
    customEndDate = new Date((startTime + timeInterval) * 1000);
  }

  // grouping can be either by build id or by version
  const versionGrouping = urlParams.get('versionGrouping') ? urlParams.get('versionGrouping') : DEFAULT_VERSION_GROUPING_TYPE;

  // percentile filter of data
  const percentileThreshold = parseInt(
    urlParams.get('percentile') ? urlParams.get('percentile') : DEFAULT_PERCENTILE, 10);

  // coerce normalized into a boolean, true if not specified
  let normalized = true;
  if (urlParams.get('normalized')) {
    normalized = (parseInt(urlParams.get('normalized'), 10));
  }

  // disabledVersions is a comma-seperated list
  let disabledVersions = new Set();
  if (urlParams.get('disabledVersions')) {
    disabledVersions = new Set(urlParams.get('disabledVersions').split(','));
  }

  return {
    startTime,
    customStartDate,
    customEndDate,
    timeInterval,
    normalized,
    disabledVersions,
    versionGrouping,
    percentile: percentileThreshold,
    validTimeIntervals: getValidTimeIntervals({
      startTime,
      timeInterval
    })
  };
};

class DetailViewComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      channel: props.match.params.channel,
      platform: props.match.params.platform,
      measure: props.match.params.measure,
      isLoading: true,
      fetchMeasureData: this.props.fetchMeasureData,
      disabledVersions: new Set(),
      seriesList: [],
      ...getOptionalParameters(props)
    };

    this.timeIntervalChanged = this.timeIntervalChanged.bind(this);
    this.cancelChooseCustomTimeInterval = this.cancelChooseCustomTimeInterval.bind(this);
    this.customTimeIntervalChosen = this.customTimeIntervalChosen.bind(this);
    this.customStartDateChanged = this.customStartDateChanged.bind(this);
    this.customEndDateChanged = this.customEndDateChanged.bind(this);
    this.isCustomTimeIntervalValid = this.isCustomTimeIntervalValid.bind(this);
    this.percentileChanged = this.percentileChanged.bind(this);
    this.normalizeCheckboxChanged = this.normalizeCheckboxChanged.bind(this);
    this.versionCheckboxChanged = this.versionCheckboxChanged.bind(this);
    this.toggleVersionGrouping = this.toggleVersionGrouping.bind(this);
  }

  componentDidMount() {
    this.fetchMeasureData(this.state);
  }

  fetchMeasureData() {
    this.setState({ isLoading: true });
    this.state.fetchMeasureData(_.pickBy({
      measure: this.state.measure,
      channel: this.state.channel,
      platform: this.state.platform,
      interval: this.state.timeInterval,
      start: this.state.startTime
    })).then(() =>
      this.setState({
        seriesList: this.getSeriesList(),
        isLoading: false
      }));
  }

  getSeriesList() {
    const measure = this.props.match.params.measure;

    const seriesMap = {};
    if (this.state.versionGrouping === 'version') {
      _.forEach(this.props.measureData, (build) => {
        if (this.state.disabledVersions.has(build.version)) {
          return;
        }
        if (!seriesMap[build.version]) {
          seriesMap[build.version] = {};
        }
        build.data.forEach((datum) => {
          const date = datum[0];
          if (!seriesMap[build.version][date]) {
            seriesMap[build.version][date] = {
              [measure]: 0,
              usage_hours: 0,
              date: new Date(date)
            };
          }

          seriesMap[build.version][date][measure] += datum[1];
          seriesMap[build.version][date].usage_hours += datum[2];
        });
      });
    } else {
      // group by build id
      _.forEach(this.props.measureData, (build, buildId) => {
        if (this.state.disabledVersions.has(buildId)) {
          return;
        }
        seriesMap[buildId] = {};
        build.data.forEach((datum) => {
          const date = datum[0];
          seriesMap[buildId][date] = {
            [measure]: datum[1],
            usage_hours: datum[2],
            date: new Date(date)
          };
        });
      });
    }

    // if we have <= 3 series, just return all verbatim
    if (Object.keys(seriesMap).length <= 3) {
      return _.map(seriesMap, (data, name) => ({
        name,
        data: _.values(data)
      }));
    }

    // take two most recent versions
    let mostRecent = Object.keys(seriesMap).sort().slice(-2);

    // if the second most recent has negligible results (<10% of) relative to the most
    // recent, just concatenate it in with the other results under "other"
    if (_.sum(_.values(seriesMap[mostRecent[0]]).map(d => d.usage_hours)) /
        _.sum(_.values(seriesMap[mostRecent[1]]).map(d => d.usage_hours)) < 0.10) {
      mostRecent = [mostRecent[1]];
    }

    const aggregated = _.reduce(
      _.filter(seriesMap, (series, name) => _.indexOf(mostRecent, name) === (-1)),
      (result, series) => {
        const newResult = _.clone(result);
        _.values(series).forEach((datum) => {
          if (!newResult[datum.date]) {
            newResult[datum.date] = _.clone(datum);
          } else {
            _.keys(newResult[datum.date]).forEach((k) => {
              if (k === measure || k === 'usage_hours') {
                newResult[datum.date][k] += datum[k];
              }
            });
          }
        });
        return newResult;
      }, {});

    return _.concat(mostRecent.map(version => ({
      name: version,
      data: _.values(seriesMap[version])
    })), [{ name: 'Older', data: _.values(aggregated) }]);
  }

  navigate(newParams, cb) {
    this.setState(newParams, cb);

    // generate a new url string, so we can link to this particular view
    const params = ['timeInterval', 'percentile', 'normalized', 'disabledVersions', 'versionGrouping'];
    if (newParams.startTime) {
      // only want to put startTime in url string if it's defined
      params.push('startTime');
    }

    const paramStr = params.map((paramName) => {
      let value = (!_.isUndefined(newParams[paramName])) ? newParams[paramName] : this.state[paramName];
      if (typeof (value) === 'boolean') {
        value = value ? 1 : 0;
      } else if (typeof (value) === 'object') {
        value = Array.from(value);
      }
      return `${paramName}=${value}`;
    }).join('&');
    this.props.history.push(`/${this.state.channel}/${this.state.platform}/${this.state.measure}?${paramStr}`);
  }

  timeIntervalChanged(ev) {
    const index = parseInt(ev.target.value, 10);
    if (index === -1) {
      // => let user select a custom time interval
      this.setState({
        choosingCustomTimeInterval: true
      });
    } else {
      const timeInterval = this.state.validTimeIntervals[index];
      this.navigate({
        customStartDate: undefined,
        customEndDate: undefined,
        startTime: timeInterval.startTime,
        timeInterval: timeInterval.interval
      }, () => {
        this.fetchMeasureData();
      });
    }
  }

  customStartDateChanged(ev) {
    this.setState({
      customStartDate: new Date(ev.target.value)
    });
  }

  customEndDateChanged(ev) {
    this.setState({
      customEndDate: new Date(ev.target.value)
    });
  }

  cancelChooseCustomTimeInterval() {
    this.setState({
      choosingCustomTimeInterval: false
    });
  }

  customTimeIntervalChosen() {
    this.setState({
      choosingCustomTimeInterval: false
    }, () => {
      const startTime = new Date(`${getDateString(this.state.customStartDate)} 00:00`);
      const endTime = new Date(`${getDateString(this.state.customEndDate)} 23:59`);
      const timeParams = {
        startTime: parseInt(startTime.getTime() / 1000.0, 10),
        timeInterval: parseInt((endTime - startTime) / 1000.0, 10)
      };
      this.navigate({
        ...timeParams,
        validTimeIntervals: getValidTimeIntervals(timeParams)
      }, () => {
        this.fetchMeasureData();
      });
    });
  }

  isCustomTimeIntervalValid() {
    return (this.state.customStartDate && this.state.customEndDate &&
            this.state.customStartDate < this.state.customEndDate);
  }

  percentileChanged(ev) {
    const index = parseInt(ev.target.value, 10);
    const chosenPercentile = PERCENTILES[index];
    this.navigate({
      percentile: chosenPercentile.value
    }, () => {
      this.setState({
        seriesList: this.getSeriesList()
      });
    });
  }

  normalizeCheckboxChanged(ev) {
    this.navigate({
      normalized: ev.target.checked
    }, () => {
      this.setState({
        seriesList: this.getSeriesList()
      });
    });
  }

  versionCheckboxChanged(ev) {
    const buildId = ev.target.name;
    const disabled = !ev.target.checked;
    const disabledVersions = new Set(this.state.disabledVersions);

    if (disabled) {
      disabledVersions.add(buildId);
    } else {
      disabledVersions.delete(buildId);
    }

    this.navigate({
      disabledVersions
    }, () => {
      this.setState({
        seriesList: this.getSeriesList()
      });
    });
  }

  toggleVersionGrouping() {
    this.navigate({
      versionGrouping: (this.state.versionGrouping === 'version') ? 'buildid' : 'version',
      disabledVersions: new Set()
    }, () => {
      this.setState({
        seriesList: this.getSeriesList()
      });
    });
  }

  getLegend() {
    if (this.state.versionGrouping === 'buildid') {
      return _.map(this.props.measureData, (data, buildId) => ({
        title: buildId,
        subtitles: [data.version]
      }));
    }

    // otherwise, group all buildids with same version together
    const versionMap = {};
    _.forEach(this.props.measureData, (build, buildId) => {
      if (!versionMap[build.version]) {
        versionMap[build.version] = [];
      }
      versionMap[build.version].push(buildId);
    });
    return Object.keys(versionMap).map(version => ({
      title: version,
      subtitles: versionMap[version]
    }));
  }

  render() {
    return (
      <div className="body-container">
        <Helmet>
          <title>
            { `${this.state.platform} ${this.state.channel} ${this.state.measure}` }
          </title>
        </Helmet>

        <SubViewNav
          className="header-element"
          breadcrumbs={[
            { name: 'Home', link: '/' },
            { name: `${this.state.platform} ${this.state.channel}`,
              link: `/${this.state.channel}/${this.state.platform}` },
            { name: this.state.measure,
              link: `/${this.state.channel}/${this.state.platform}/${this.state.measure}` }
          ]} />
        <div className="body-element">
          <div className="container center">
            <Row>
              <form className="form-inline">
                <select
                  value={
                    this.state.validTimeIntervals.findIndex(timeInterval =>
                      timeInterval.interval === this.state.timeInterval &&
                      ((this.state.startTime &&
                        (timeInterval.startTime === this.state.startTime)) ||
                       (!this.state.startTime && !timeInterval.startTime)))
                  }
                  onChange={this.timeIntervalChanged}
                  className="mb-2 mr-sm-2 mb-sm-0">
                  {
                    this.state.validTimeIntervals.map(
                      (timeInterval, index) => (
                        <option
                          key={`${timeInterval.startTime || ''}-${timeInterval.interval}`}
                          value={index} >
                          {timeInterval.label}
                        </option>
                      )
                    )
                  }
                  <option value="-1">Custom...</option>
                </select>
                <Modal
                  isOpen={this.state.choosingCustomTimeInterval}
                  toggle={this.cancelChooseCustomTimeInterval}>
                  <ModalHeader toggle={this.cancelChooseCustomTimeInterval}>
                    Custom Date Range
                  </ModalHeader>
                  <ModalBody>
                    <FormGroup>
                      <Label for="startDate">
                        Start Date
                      </Label>
                      <Input
                        type="date"
                        onChange={this.customStartDateChanged}
                        id="startDate"
                        defaultValue={getDateString(this.state.customStartDate)} />
                    </FormGroup>
                    <FormGroup>
                      <Label for="endDate">
                        End Date
                      </Label>
                      <Input
                        type="date"
                        onChange={this.customEndDateChanged}
                        id="endDate"
                        defaultValue={getDateString(this.state.customEndDate)} />
                    </FormGroup>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      color="primary"
                      disabled={!this.isCustomTimeIntervalValid()}
                      onClick={this.customTimeIntervalChosen}>Ok</Button>
                  </ModalFooter>
                </Modal>
                <select
                  value={
                    PERCENTILES.findIndex(p => p.value === this.state.percentile)
                  }
                  onChange={this.percentileChanged}
                  className="mb-2 mr-sm-2 mb-sm-0">
                  {
                    PERCENTILES.map(
                      (p, index) => (
                        <option
                          key={`PERCENTILE-${p.value}`}
                          value={index} >
                          {p.label}
                        </option>
                      )
                    )
                  }
                </select>
                <FormGroup
                  check
                  title="Normalize measure by number of usage hours">
                  <Label check>
                    <Input
                      type="checkbox"
                      checked={this.state.normalized}
                      onChange={this.normalizeCheckboxChanged} />
                    {' '}
                    Normalize
                  </Label>
                </FormGroup>
              </form>
            </Row>
            {
              this.state.isLoading &&
              <Row>
                <Loading />
              </Row>
            }
            {
              !this.state.isLoading &&
              <div>
                <Row>
                  <Col xs="10">
                    <Container>
                      <Row>
                        <Col>
                          <div
                            className="large-graph-container center"
                            id="measure-series">
                            <MeasureGraph
                              title={`${this.props.match.params.measure} ${(this.state.normalized) ? 'per 1k hours' : ''}`}
                              seriesList={
                                getTransformedSeriesList(this.state.seriesList,
                                                         this.props.match.params.measure,
                                                         this.state.normalized,
                                                         this.state.percentile)
                              }
                              y={`${this.props.match.params.measure}`}
                              linked={true}
                              linked_format="%Y-%m-%d-%H-%M-%S" />
                          </div>
                        </Col>
                      </Row>
                      <Row>
                        <Col>
                          <div
                            className="large-graph-container center"
                            id="time-series">
                            <MeasureGraph
                              title="Usage khours"
                              seriesList={this.state.seriesList}
                              y={'usage_hours'}
                              linked={true}
                              linked_format="%Y-%m-%d-%H-%M-%S" />
                          </div>
                        </Col>
                      </Row>
                    </Container>
                  </Col>
                  <Col xs="2">
                    <FormGroup tag="fieldset">
                      <legend>
                        {
                          this.state.versionGrouping === 'version' ? 'Version' : 'buildid'
                        }
                      </legend>
                      {
                        this.props.measureData &&
                        this.getLegend().sort((a, b) => a.title < b.title).map(
                          item => (
                            <Label key={item.title} check>
                              <Input
                                name={item.title}
                                type="checkbox"
                                checked={!this.state.disabledVersions.has(item.title)}
                                onChange={this.versionCheckboxChanged} />
                              {' '}
                              {item.title}
                              <small>
                                <ul className="list-unstyled">
                                  {
                                    item.subtitles.map(subtitle => (
                                      <dd key={`buildid-${subtitle}`}>
                                        {subtitle}
                                      </dd>
                                    ))
                                  }
                                </ul>
                              </small>
                            </Label>))
                      }
                    </FormGroup>
                    <Button color="link" size="sm" onClick={this.toggleVersionGrouping}>
                      {`Group by ${this.state.versionGrouping === 'version' ? 'buildid' : 'version'} instead`}
                    </Button>
                  </Col>
                </Row>
              </div>
            }
          </div>
        </div>
      </div>
    );
  }
}

const DetailView = connect(mapStateToProps)(DetailViewComponent);

export default DetailView;
