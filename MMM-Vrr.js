/* global Module */

/* Magic Mirror
 * Module: MMM-Vrr
 *
 * By Steven Zemelka <hello@zemelka.codes>
 * MIT Licensed.
 */

Module.register("MMM-Vrr", {
    defaults: {
        updateInterval: 60000,
        retryDelay: 30000,
        city: 'Düsseldorf',
        station: 'Hauptbahnhof',
        numberOfResults: 10,
        displayIcons: true,
        displayTimeOption: 'countdown', // time, time+countdown
        setWidth: false,
        scrollAfter: 15
    },

    requiresVersion: "2.1.0", // Required version of MagicMirror

    start: function () {
        var self = this;
        var dataRequest = null;
        var dataNotification = null;

        moment.locale(config.language);

        moment.updateLocale(config.language, {
            relativeTime: {
                s: this.translate("NOW"),
                m: "1 " + this.translate("MINUTE"),
                mm: "%d " + this.translate("MINUTE"),
                h: "+1 " + this.translate("HOUR"),
                hh: "%d " + this.translate("HOUR")
            }
        });

        //Flag for check if module is loaded
        this.loaded = false;
        // Schedule update timer.
        this.getData();
        setInterval(function () {
            self.updateDom();
        }, this.config.updateInterval);
    },

    /*
     * getData
     * get a URL request
     *
     */
    getData: function () {
        var self = this;

        var urlApi = "https://vrrf.finalrewind.org/" + this.config.city + "/" + this.config.station + ".json?frontend=json&no_lines=" + this.config.numberOfResults + "";
        var retry = true;

        var dataRequest = new XMLHttpRequest();
        dataRequest.open("GET", urlApi, true);
        dataRequest.onreadystatechange = function () {
            console.log(this.readyState);
            if (this.readyState === 4) {
                console.log(this.status);
                if (this.status === 200) {
                    self.processData(JSON.parse(this.response));
                } else if (this.status === 401) {
                    self.updateDom(self.config.animationSpeed);
                    Log.error(self.name, this.status);
                    retry = false;
                } else {
                    Log.error(self.name, "Could not load data.");
                }
                if (retry) {
                    self.scheduleUpdate((self.loaded) ? -1 : self.config.retryDelay);
                }
            }
        };
        dataRequest.send();
    },


    /* scheduleUpdate()
     * Schedule next update.
     *
     * argument delay number - Milliseconds before next update.
     *  If empty, this.config.updateInterval is used.
     */
    scheduleUpdate: function (delay) {
        var nextLoad = this.config.updateInterval;
        if (typeof delay !== "undefined" && delay >= 0) {
            nextLoad = delay;
        }
        nextLoad = nextLoad;
        var self = this;
        setTimeout(function () {
            self.getData();
        }, nextLoad);
    },

    getDom: function () {
        var self = this;

        // create element wrapper for show into the module
        var tableWrapper = document.createElement("table");
        tableWrapper.className = "small mmm-vrr-table";

        if(this.config.setWidth){
            tableWrapper.setAttribute('style', 'width:'+this.config.setWidth+'px');
        }
        // If this.dataRequest is not empty
        if (this.dataRequest) {

            var apiResult = this.dataRequest;

            var tableHeadRow = document.createElement("tr");
            tableHeadRow.className = 'border-bottom';

            var tableHeadValues = [
                this.translate("LINE"),
                this.translate('DESTINATION'),
                this.translate('DEPARTURE')
            ];

            for (var thCounter = 0; thCounter < tableHeadValues.length; thCounter++) {
                var tableHeadSetup = document.createElement("th");
                tableHeadSetup.innerHTML = tableHeadValues[thCounter];

                if (this.config.displayIcons) {
                    if (thCounter === 0) {
                        tableHeadSetup.setAttribute('colspan', '2')
                    }
                }

                tableHeadRow.appendChild(tableHeadSetup);
            }

            tableWrapper.appendChild(tableHeadRow);

            var usableResults = self.removeResultsFromThePast(apiResult.raw);

            for (var trCounter = 0; trCounter < this.config.numberOfResults; trCounter++) {

                var obj = usableResults[trCounter];

                var trWrapper = document.createElement("tr");
                trWrapper.className = 'tr';

                if (this.config.displayIcons) {
                    var icon = self.createMatchingIcon(obj.type);
                    trWrapper.appendChild(icon);
                }

                var remainingTime = self.calculateRemainingMinutes(obj.sched_date, obj.sched_time);
                var timeValue;
                switch (this.config.displayTimeOption) {
                    case 'time+countdown':
                        timeValue = obj.sched_time + " (" + remainingTime + ")";
                        break;
                    case 'time':
                        timeValue = obj.sched_time;
                        break;
                    default:
                        timeValue = remainingTime;
                }

                var adjustedLine = self.stripLongeLineNames(obj);

                var tdValues = [
                    adjustedLine,
                    obj.destination,
                    timeValue
                ];

                for (var c = 0; c < tdValues.length; c++) {
                    var tdWrapper = document.createElement("td");

                        if(tdValues[c].length > parseInt(this.config.scrollAfter) && this.config.setWidth){
                            tdWrapper.innerHTML = '<marquee scrollamount="3" >'+tdValues[c]+'<marquee>';
                        } else {
                            tdWrapper.innerHTML = tdValues[c];
                        }

                    trWrapper.appendChild(tdWrapper);
                }

                tableWrapper.appendChild(trWrapper);
            }

            tableWrapper.appendChild(trWrapper);
        }



        return tableWrapper;
    },


    /**
     * Removes results from the past
     * check calculateRemainingMinutes() for more details
     * @param apiResult
     * @returns {*}
     */
    removeResultsFromThePast: function (apiResult) {
        var self = this;
        var cleanedResults = [];
        for (var i = 0; i < apiResult.length; i++) {
            var singleRoute = apiResult[i];

            var isInPast = self.calculateRemainingMinutes(singleRoute.sched_date, singleRoute.sched_time, true);

            if (!isInPast) {
                cleanedResults.push(apiResult[i]);
            }
        }

        return cleanedResults;
    },

    /**
     * Removes unnecessary long Transport Type name (like 'InterCityExpress")
     * @param routeData
     * @returns {XML|void|string}
     */
    stripLongeLineNames: function (routeData) {
        return routeData.line.substr(0, 7);
    },

    /**
     * Manual Calculation for the remaining Time until departure
     * The API returns already the remaining Minutes, but the raw results seem to be oddly cached.
     * Without this method it resulted in a difference from up to 5 Minutes
     *
     * Alsow checks if the departure time is in the past, because we only want upcoming results.
     * @param departureDay - DD-MM-YYYY
     * @param departureTime - HH:mm
     * @param returnPastCheck
     */
    calculateRemainingMinutes: function (departureDay, departureTime, returnPastCheck = false) {
        var dateAndTime = moment(departureDay + " " + departureTime, "DD-MM-YYYY HH:mm");

        if (returnPastCheck) {
            var unixDifference = dateAndTime.diff(moment.now());
            return unixDifference < 0;
        }

        return dateAndTime.fromNow(true);
    },

    /**
     * Creates the right icon for the Route
     * @param transportType
     * @returns {Node}
     */
    createMatchingIcon: function (transportType) {

        var type = document.createElement("td");
        var symbolType;
        switch (transportType) {
            case 'S-Bahn':
                symbolType = 'train';
                break;
            case 'U-Bahn':
                symbolType = 'subway';
                break;
            case 'InterCityExpress':
                symbolType = 'train';
                break;
            case 'TaxiBus':
                symbolType = 'taxi';
                break;
            default:
                symbolType = 'bus';
                break;
        }
        var symbol = document.createElement("span");
        symbol.className = "fa fa-" + symbolType;

        type.appendChild(symbol);

        return type;
    },

    /**
     *  Define required styles.
     *  @returns {[string]}
     */
    getScripts: function () {
        return ["moment.js"];
    },

    /**
     * Define required styles.
     * @returns {[string,string]}
     */
    getStyles: function () {
        return ["MMM-Vrr.css", "font-awesome.css"];
    },

    /**
     * Load translations files
     * @returns {{en: string, de: string}}
     */
    getTranslations: function () {
        return {
            en: "translations/en.json",
            de: "translations/de.json"
        };
    },

    processData: function (data) {
        var self = this;
        this.dataRequest = data;

        if (this.loaded === false) {
            self.updateDom(self.config.animationSpeed);
        }
        this.loaded = true;

        // the data if load
        // send notification to helper
        this.sendSocketNotification("MMM-Vrr-NOTIFICATION_TEST", data);
    },

    // socketNotificationReceived from helper
    socketNotificationReceived: function (notification, payload) {
        if (notification === "MMM-Vrr-NOTIFICATION_TEST") {
            // set dataNotification
            this.dataNotification = payload;
            this.updateDom();
        }
    },
});
