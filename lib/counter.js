'use strict';

const prettyMilliseconds = require('pretty-ms');

module.exports = class MovingAverage {
    constructor(time) {
        this.time = time;
        this.events = [];
    }

    startEvent() {
        this.events.push({ start: Date.now(), stop: 0 });
    }

    stopEvent() {
        if (this.events.length > 0) {
            let startEvent = this.events[this.events.length - 1];
            if (startEvent.stop === 0) {
                startEvent.stop = Date.now();
            }
            //else ignore stop event
        }
    }

    averageRunTime() {
        let sum = 0;
        let no = 0;
        let start = Date.now() - this.time;
        this.events.forEach(function (event) {
            if (event.start > start && event.stop > 0) {
                sum = sum + (event.stop - event.start);
                no++;
            }
        });
        return sum / no;
    }

    averageRunTimePretty() {
        return prettyMilliseconds(this.averageRunTime() || 0);
    }

    numberOfEvents() {
        let no = 0;
        let start = Date.now() - this.time;
        this.events.forEach(function (event) {
            if (event.start > start) {
                no++;
            }
        });
        return no;
    }

    cleanOldEvents() {
        if (this.events.length > 0) {
            let start = Date.now() - this.time;
            for (var i = this.events.length - 1; i--;) {
                if (this.events[i].start < start) {
                    //console.log('Cleaning 1 old event');
                    this.events.splice(i, 1);
                }
            }
        }
    }

}

