'use strict';

const Homey = require('homey');
const Particle = require('particle-api-js');

class HeaterDriver extends Homey.Driver {

	onInit() {
		this.log('Particle Heater device driver has been initialized');
		this.flowCards = {};

		this._registerFlows();
	}

	_registerFlows() {
		this.log('Registering flows');

		// Register device triggers
		let triggers = [
			'device_connected',
			'device_disconnected'		];
		this._registerFlow('trigger', triggers, Homey.FlowCardTriggerDevice);
	}

	_registerFlow(type, keys, cls) {
		keys.forEach(key => {
			this.log(`- flow '${type}.${key}'`);
			this.flowCards[`${type}.${key}`] = new cls(key).register();
		});
	}

	async triggerFlow(flow, tokens, device) {
		this.log(`Triggering flow '${flow}' with tokens`, tokens);
		if (this.flowCards[flow] instanceof Homey.FlowCardTriggerDevice) {
			this.log('- device trigger for ', device.getName());
			this.flowCards[flow].trigger(device, tokens);
		}
		else if (this.flowCards[flow] instanceof Homey.FlowCardTrigger) {
			this.log('- regular trigger');
			this.flowCards[flow].trigger(tokens);
		}
	}

	onPairListDevices(data, callback) {
		let devices = [];
		let particle = new Particle();
		particle.listDevices({ auth: Homey.ManagerSettings.get('access_token') })
			.then(
				function (response) {
					//console.log('Devices: ', response.body);
					if (response.body) {
						response.body.forEach(cloud_device => {
							//Only possible to add devices that are online
							if (cloud_device.connected) {
								devices.push({
									name: cloud_device.name,
									data: {
										id: cloud_device.id,
									}
								});
							}
						});

						devices.sort(function (a, b) {
							var nameA = a.name.toUpperCase();
							var nameB = b.name.toUpperCase();
							if (nameA < nameB) {
								return -1;
							}
							if (nameA > nameB) {
								return 1;
							}
							// names must be equal
							return 0;
						});
					}

					callback(null, devices);
				},
				function (err) {
					this.log('List devices call failed: ', err);
					callback({
						'en': 'No cloud devices were found, please check your api token'
					}, null);
				}
			);
	}

}

module.exports = HeaterDriver;
