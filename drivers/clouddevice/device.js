'use strict';

const Homey = require('homey');
const Particle = require('particle-api-js');

class CloudDevice extends Homey.Device {

  onInit() {
    this.log('Device initiated', this.getName());

    this.pollIntervals = [];
    this.refresh_interval = this.getSettings().refresh_interval || 60;
    this.generateDeviceEvents = this.getSettings().generate_device_events || 'no';

    this.device = {
      id: this.getData().id,
      name: this.getName(),
      info: null,
      functions: [],
      variables: [],
      eventStream: null
    };

    this.refreshCloudDeviceActionsAndVariables();

    //Values are refreshed continously
    this.refreshCloudDeviceStatus();

    this._initilializeTimers();

    this._startDeviceEventListener();
  }

  _startDeviceEventListener() {
    var self = this;
    if (this.generateDeviceEvents === 'yes') {
      self.log('Starting device event listener');

      new Particle().getEventStream({ deviceId: this.device.id, auth: Homey.ManagerSettings.get('access_token') })
        .then(function(stream) {
          self.device.eventStream = stream;
          stream.on('event', function(event) {
            let particleEvent = {event_name: event.name || 'unknown',
                                event_value: event.data || 'unknown'}
            self.getDriver().triggerFlow('trigger.device_event', particleEvent, self);
          });
      });
    }
  }
  _stopDeviceEventListener() {
    if (this.device.eventStream) {
      this.log('Stopping device event listener');
      this.device.eventStream.abort();
      this.device.eventStream = undefined;
    }
  }

  _restartDeviceEventListener() {
    this._stopDeviceEventListener();
    this._startDeviceEventListener();
  }

  _initilializeTimers() {
    this.log('Adding timers');
    // Start a poller, to check the device status
    this.pollIntervals.push(setInterval(() => {
        this.refreshCloudDeviceStatus();
    }, this.refresh_interval * 1000));

  }

  _deleteTimers() {
    //Kill interval object(s)
    this.log('Removing timers');
    this.pollIntervals.forEach(timer => {
        clearInterval(timer);
    });
  }

  _reinitializeTimers() {
    this._deleteTimers();
    this._initilializeTimers();
  }

  onDeleted() {
    this.log(`Deleting device '${this.getName()}' from Homey.`);
    this._deleteTimers();
    this._stopDeviceEventListener();
    this.device = null;
  }

  onRenamed (name) {
    this.log(`Renaming device from '${this.device.name}' to '${name}'`)
    this.device.name = name;
  }

  refreshCloudDeviceActionsAndVariables() {
    var self = this;
    this.log('Refreshing device actions and variables');
    new Particle().getDevice({ deviceId: this.device.id, auth: Homey.ManagerSettings.get('access_token') })
    .then(
      function(data) {
        let device = data.body;
        let deviceVariables = [];
        if (device.variables) {
          Object.keys(device.variables).forEach(key => {
            deviceVariables.push({
                id: self.device.id,
                name: key,
                type: device.variables[key]
            });
          });
        }
        self.device.variables = deviceVariables;

        let deviceFunctions = [];
        if (device.functions != null && device.functions.length > 0) {
          device.functions.forEach(func => {
            deviceFunctions.push({
                id: self.device.id,
                name: func,
                device_name: device.name
            });
          });
        }
        self.device.functions = deviceFunctions;
      },
      function(err) {
        self.log('Failed to refresh device variables and functions: ', err);
      }
    );
  }

  getDeviceVariableValue(variableName) {
    //If device is offline then we cant invoke a function
    if (!this.device.info.connected) {
      return Promise.resolve(null);
    }

    return new Particle().getVariable({ deviceId: this.device.id, name: variableName, auth: Homey.ManagerSettings.get('access_token') })
      .then(function(data) {
        let value = null;
        if (data && data.body && data.body.result !== null) {
          value = data.body.result;
        }
        return value;
      }, function(err) {
        self.log('Variable call failed: ', err);
        return null;
      });
  }

  callDeviceFunction(functionName, args) {
    //If device is offline then we cant invoke a function
    if (!this.device.info.connected) {
      return Promise.resolve({statusCode: 400});
    }

    var self = this;
    return new Particle().callFunction({ deviceId: this.device.id, name: functionName, argument: args, auth: Homey.ManagerSettings.get('access_token') })
    .then(
      function(data) {
        return data;
      }, function(err) {
        if (err.statusCode && err.statusCode === 400) {
          self.log('Device most likely offline');
          self.log(err.body);
        } else {
          self.log('Function call failed: ', err);
        }
        return Promise.resolve({statusCode: err.statusCode || 500});
    });
  }

  refreshCloudDeviceStatus() {
    var self = this;
    new Particle().getDevice({ deviceId: this.device.id, auth: Homey.ManagerSettings.get('access_token') })
      .then(
        function(data) {
          let device = data.body;
          //If connected change from false to true we should refresh variables and functions
          if (device.connected && self.isCapabilityValueChanged('connected', device.connected)) {
            self.log('Device came online, lets refresh variables and functions');
            self.refreshCloudDeviceActionsAndVariables();
          }

          //Update capabilities of cloud device
          self._updateProperty('connected', device.connected);

          self.device.info = device;

          let lastHeardDate = new Date(device.last_heard)
            .toLocaleDateString('en-US', {day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});

          //Update Homey settings in advanced tab
          self.setSettings({serial_number: device.serial_number,
                            firmware_version: device.system_firmware_version,
                            last_ip_address: device.last_ip_address,
                            last_heard: lastHeardDate})
            .catch(err => {
              self.error('failed to update settings', err);
            });

        },
        function(err) {
          self.log('Failed to refresh device status: ', err);
        }
    );
  }

  _updateProperty(key, value) {
    if (this.isCapabilityValueChanged(key, value)) {
      this.log(`[${this.getName()}] Updating capability '${key}' from '${this.getCapabilityValue(key)}' to '${value}'`);
      this.setCapabilityValue(key, value);

      let tokens = {};
      if (key == 'connected') {
          let deviceTrigger = 'trigger.device_connected';
          let conditionTrigger = 'trigger.a_device_connected';
          if (value === false) {
              deviceTrigger = 'trigger.device_disconnected';
              conditionTrigger = 'trigger.a_device_disconnected';
          }

          this.getDriver().triggerFlow(deviceTrigger, tokens, this);

          tokens = {
              serial: this.getSettings().serial_number,
              name: this.getName(),
              ip_address: this.getSettings().last_ip_address
          }
          this.getDriver().triggerFlow(conditionTrigger, tokens, this);
      }
    } else {
      //Update value to refresh timestamp in app
      this.setCapabilityValue(key, value);
    }
  }

  isCapabilityValueChanged(key, value) {
    let oldValue = this.getCapabilityValue(key);
    //If oldValue===null then it is a newly added device, lets not trigger flows on that
    if (oldValue !== null && oldValue != value) {
      return true;
    } else {
      return false;
    }
  }

  async onSettings(oldSettings, newSettings, changedKeysArr) {
		if (changedKeysArr.indexOf("refresh_interval") > -1) {
			this.log('Refresh interval value was change to:', newSettings.refresh_interval);
      this.refresh_interval = newSettings.refresh_interval;
      //We also need to re-initialize the timer
      this._reinitializeTimers();
		}

    if (changedKeysArr.indexOf("generate_device_events") > -1) {
			this.log('Generate device events was change to:', newSettings.generate_device_events);
      this.generateDeviceEvents = newSettings.generate_device_events;
      this._restartDeviceEventListener();
		}

	}

}

module.exports = CloudDevice;
