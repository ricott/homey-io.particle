'use strict';

const CompressorCounter = require('../lib/counter.js');

let compCounter = new CompressorCounter(10000);


compCounter.startEvent();

sleep(2000).then(() => {
    compCounter.stopEvent();

    console.log(compCounter.averageRunTimePretty());
    console.log(compCounter.numberOfEvents());

    compCounter.startEvent();

    sleep(6000).then(() => {
        compCounter.stopEvent();

        console.log(compCounter.averageRunTimePretty());
        console.log(compCounter.numberOfEvents());

        compCounter.cleanOldEvents();

        console.log(compCounter.averageRunTimePretty());
        console.log(compCounter.numberOfEvents());
    });
});




function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}
