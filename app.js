'use strict';

const Homey = require('homey');

class MyApp extends Homey.App {

	async onInit() {
		this.log('Particle Device Cloud is connected...');
	}

}

module.exports = MyApp;
