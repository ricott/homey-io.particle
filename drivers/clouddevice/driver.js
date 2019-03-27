'use strict';

const Homey	= require('homey');
const Particle = require('particle-api-js');

const variableConditionList = [
	{id: 'known', name: 'Is known'},
  {id: 'string.contains', name: 'Contains'},
  {id: 'string.equals', name: 'Equals (string)'},
  {id: 'boolean.equals', name: 'Equals (boolean)'},
  {id: 'number.equals', name: 'Equals (number)'},
  {id: 'string.above', name: 'Above (alphabetic)'},
  {id: 'string.below', name: 'Below (alphabetic)'},
  {id: 'number.above', name: 'Above (number)'},
  {id: 'number.below', name: 'Below (number)'}
];

class CloudDeviceDriver extends Homey.Driver {

	onInit() {
		this.log('Particle Device Cloud driver has been initialized');
		this.flowCards = {};

		this._registerFlows();
	}

	_registerFlows() {
    this.log('Registering flows');

		// Register normal triggers
		let triggers = [
			'a_device_connected',
			'a_device_disconnected'
		];
		this._registerFlow('trigger', triggers, Homey.FlowCardTrigger);

		// Register device triggers
		triggers = [
			'device_connected',
			'device_disconnected',
			'device_event'
		];
		this._registerFlow('trigger', triggers, Homey.FlowCardTriggerDevice);

		triggers = [
			'particle_variable_condition'
		];
		this._registerFlow('condition', triggers, Homey.FlowCardCondition);

		this.flowCards['condition.particle_variable_condition']
			.registerRunListener((args, state, callback) => {
				this.log('----- Condition triggered');
				this.log(`Variable name: '${args.variable.name}'`);
				this.log(`Condition type: '${args.conditionType.id}'`);
				let conditionValue = '';
				if (args.conditionValue) {
					conditionValue = args.conditionValue.toLowerCase();
				}
				this.log(`Parameter: '${conditionValue}'`);

				switch (args.conditionType.id) {
			    case 'boolean.equals':
			      this.log('check type boolean', typeof conditionValue, conditionValue === 'false' || conditionValue === 'true');
			      if (conditionValue !== 'false' && conditionValue !== 'true') {
							return Promise.reject(Homey.__('error.errorInConditionValueBoolean', { 'conditionValue': conditionValue }));
						}
			      break;
			    case 'number.equals':
			    case 'number.above':
			    case 'number.below':
			      this.log('check type number', typeof conditionValue, !isNaN(conditionValue));
			      if (isNaN(conditionValue)) {
							return Promise.reject(Homey.__('error.errorInConditionValueNumber', { 'conditionValue': conditionValue }));
						}
			      break;
			  }

				return args.device.getDeviceVariableValue(args.variable.name)
			  .then((response) => {
			    this.log('Api condition returned value:', response);
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

		this.flowCards['condition.particle_variable_condition']
			.getArgument('variable')
	  	.registerAutocompleteListener((query, args) => {
				return Promise.resolve(args.device.device.variables);
			});
		this.flowCards['condition.particle_variable_condition']
			.getArgument('conditionType')
	  	.registerAutocompleteListener((query, args) => {
				return Promise.resolve(variableConditionList);
			});

		triggers = [
			'particle_function',
			'particle_event'
		];
		this._registerFlow('action', triggers, Homey.FlowCardAction);

		this.flowCards['action.particle_function'].registerRunListener(( args, state ) => {
			this.log('----- Action triggered');
			this.log(`Function name: '${args.function.device_name} - ${args.function.name}'`);
			this.log(`Parameter: '${args.parameter}'`);

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

			  	this.log(`Function response: '${responseValue}' with status '${responseStatus}'`);
					if (responseStatus === 200) {
						return Promise.resolve(true);
					} else {
						return Promise.reject(Homey.__('error.failureCallFunction', { 'responseStatus': responseStatus }));
					}
			});
		})
			.getArgument('function')
			.registerAutocompleteListener((query, args) => {
				return Promise.resolve(args.device.device.functions);
			});

		this.flowCards['action.particle_event'].registerRunListener(( args, state ) => {
			this.log('----- Action triggered');
			this.log(`Event name: '${args.event_name}', with data: '${args.event_data}'`);
			this.log(`isPrivate: '${args.event_private}'`);

			//eventName, data, isPrivate
			return this.publishEvent(args.event_name, args.event_data, args.event_private)
				.then((status) => {
			  	this.log(`Publish event status: '${status}'`);
					if (status) {
						return Promise.resolve(true);
					} else {
						return Promise.reject(Homey.__('error.failurePublishEvent'));
					}
			});
		});
	}

	publishEvent(eventName, data, isPrivate) {
    var self = this;
    return new Particle().publishEvent({ name: eventName, data: data, isPrivate: isPrivate, auth: Homey.ManagerSettings.get('access_token') })
    .then(
      function(data) {
        let status = false;
        if (data && data.body && data.body.ok !== null) {
          status = data.body.ok;
        }
        return status;
      },
      function(err) {
        self.log("Failed to publish event: " + err);
				return false;
      }
    );
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

	// alternatively, use the shorthand method
  onPairListDevices(data, callback) {

		let devices = [];
		let particle = new Particle();
		particle.listDevices({ auth: Homey.ManagerSettings.get('access_token') })
		.then(
		  function(response) {
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

		      devices.sort(function(a, b) {
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
		  function(err) {
		    this.log('List devices call failed: ', err);
				callback({
					'en': 'No cloud devices were found, please check your api token'
				}, null);
		  }
		);
	}

}

module.exports = CloudDeviceDriver;
