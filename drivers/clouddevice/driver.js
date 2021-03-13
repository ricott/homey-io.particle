'use strict';

const Homey = require('homey');
const Particle = require('particle-api-js');

const variableConditionList = [
	{ id: 'known', name: 'Is known' },
	{ id: 'string.contains', name: 'Contains' },
	{ id: 'string.equals', name: 'Equals (string)' },
	{ id: 'boolean.equals', name: 'Equals (boolean)' },
	{ id: 'number.equals', name: 'Equals (number)' },
	{ id: 'string.above', name: 'Above (alphabetic)' },
	{ id: 'string.below', name: 'Below (alphabetic)' },
	{ id: 'number.above', name: 'Above (number)' },
	{ id: 'number.below', name: 'Below (number)' }
];

class CloudDeviceDriver extends Homey.Driver {

	async onInit() {
		this.log('Particle Device Cloud driver has been initialized');
		this.flowCards = {};

		this._registerFlows();
	}

	_registerFlows() {
		this.log('Registering flows');

		// Register normal triggers
		this.flowCards['a_device_connected'] = this.homey.flow.getTriggerCard('a_device_connected');
		this.flowCards['a_device_disconnected'] = this.homey.flow.getTriggerCard('a_device_disconnected');

		// Register device triggers
		this.flowCards['device_connected'] = this.homey.flow.getDeviceTriggerCard('device_connected');
		this.flowCards['device_disconnected'] = this.homey.flow.getDeviceTriggerCard('device_disconnected');
		this.flowCards['device_event'] = this.homey.flow.getDeviceTriggerCard('device_event');
		
		//Conditions
		this.flowCards['particle_variable_condition'] =
			this.homey.flow.getConditionCard('particle_variable_condition')
				.registerRunListener(async (args, state) => {
					this.log(`[${args.device.getName()}] Condition triggered`);
					this.log(`[${args.device.getName()}] Variable name: '${args.variable.name}'`);
					this.log(`[${args.device.getName()}] Condition type: '${args.conditionType.id}'`);
					let conditionValue = '';
					if (args.conditionValue) {
						conditionValue = args.conditionValue.toLowerCase();
					}
					this.log(`[${args.device.getName()}] Parameter: '${conditionValue}'`);

					switch (args.conditionType.id) {
						case 'boolean.equals':
							this.log('check type boolean', typeof conditionValue, conditionValue === 'false' || conditionValue === 'true');
							if (conditionValue !== 'false' && conditionValue !== 'true') {
								return Promise.reject(this.homey.__('error.errorInConditionValueBoolean', { 'conditionValue': conditionValue }));
							}
							break;
						case 'number.equals':
						case 'number.above':
						case 'number.below':
							this.log('check type number', typeof conditionValue, !isNaN(conditionValue));
							if (isNaN(conditionValue)) {
								return Promise.reject(this.homey.__('error.errorInConditionValueNumber', { 'conditionValue': conditionValue }));
							}
							break;
					}

					return args.device.getDeviceVariableValue(args.variable.name)
						.then((response) => {
							this.log(`[${args.device.getName()}] Api condition returned value:`, response);
							var isNull = response === null || response === undefined;
							switch (args.conditionType.id) {
								case 'boolean.equals':
									return Promise.resolve((!isNull && response.toString() === conditionValue));
								case 'known':
									return Promise.resolve(!isNull);
								case 'string.equals':
									return Promise.resolve((!isNull && response.toLowerCase() === conditionValue));
								case 'string.contains':
									return Promise.resolve((!isNull && response.toLowerCase().includes(conditionValue)));
								case 'string.above':
									return Promise.resolve((!isNull && response.toLowerCase() > conditionValue));
								case 'string.below':
									return Promise.resolve((!isNull && response.toLowerCase() < conditionValue));
								case 'number.equals':
									return Promise.resolve((!isNull && response == conditionValue));
								case 'number.above':
									return Promise.resolve((!isNull && response > conditionValue));
								case 'number.below':
									return Promise.resolve((!isNull && response < conditionValue));
							}
							return Promise.reject('unknown_conditionType');
						})
						.catch(Promise.reject);
				});

		this.flowCards['particle_variable_condition']
			.registerArgumentAutocompleteListener('variable',
				async (query, args) => {
					return args.device.device.variables;
				}
			);

		this.flowCards['particle_variable_condition']
			.registerArgumentAutocompleteListener('conditionType',
				async (query, args) => {
					return variableConditionList;
				}
			);

		this.flowCards['particle_function'] =
			this.homey.flow.getActionCard('particle_function')
				.registerRunListener(async (args) => {
					this.log(`[${args.device.getName()}] Action triggered`);
					this.log(`[${args.device.getName()}] Function name: '${args.function.device_name} - ${args.function.name}'`);
					this.log(`[${args.device.getName()}] Parameter: '${args.parameter}'`);

					return args.device.callDeviceFunction(args.function.name, args.parameter)
						.then((response) => {
							let responseValue = '';
							if (response && response.body && response.body.return_value !== null) {
								responseValue = response.body.return_value;
							}
							let responseStatus = 500;
							if (response && response.statusCode !== null) {
								responseStatus = response.statusCode;
							}

							this.log(`[${args.device.getName()}] Function response: '${responseValue}' with status '${responseStatus}'`);
							if (responseStatus === 200) {
								return Promise.resolve(true);
							} else {
								return Promise.reject(this.homey.__('error.failureCallFunction', { 'responseStatus': responseStatus }));
							}
						});
				});

		this.flowCards['particle_function']
			.registerArgumentAutocompleteListener('function',
				async (query, args) => {
					return args.device.device.functions;
				}
			);

		this.flowCards['particle_event'] =
			this.homey.flow.getActionCard('particle_event')
				.registerRunListener(async (args) => {
					this.log(`[${args.device.getName()}] Action triggered`);
					this.log(`[${args.device.getName()}] Event name: '${args.event_name}', with data: '${args.event_data}'`);
					this.log(`[${args.device.getName()}] isPrivate: '${args.event_private}'`);

					//eventName, data, isPrivate
					return this.publishEvent(args.event_name, args.event_data, args.event_private)
						.then((status) => {
							this.log(`[${args.device.getName()}] Publish event status: '${status}'`);
							if (status) {
								return Promise.resolve(true);
							} else {
								return Promise.reject(this.homey.__('error.failurePublishEvent'));
							}
						});
				});
	}

	publishEvent(eventName, data, isPrivate) {
		var self = this;
		return new Particle().publishEvent({ name: eventName, data: data, isPrivate: isPrivate, auth: this.homey.settings.get('access_token') })
			.then(
				function (data) {
					let status = false;
					if (data && data.body && data.body.ok !== null) {
						status = data.body.ok;
					}
					return status;
				},
				function (err) {
					self.log("Failed to publish event: " + err);
					return false;
				}
			);
	}

	triggerFlow(flow, tokens) {
		this.log(`Triggering flow '${flow}' with tokens`, tokens);
		this.log('- regular trigger');
		this.flowCards[flow].trigger(tokens);
	}
	
	triggerDeviceFlow(flow, tokens, device) {
		this.log(`[${device.getName()}] Triggering device flow '${flow}' with tokens`, tokens);
		this.flowCards[flow].trigger(device, tokens);
	}

	async onPairListDevices() {
		let devices = [];
		let particle = new Particle();
		return particle.listDevices({ auth: this.homey.settings.get('access_token') })
			.then(function (response) {
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

				return devices;
			},
				function (err) {
					this.log('List devices call failed: ', err);
					return devices;
				}
			);
	}

}

module.exports = CloudDeviceDriver;
