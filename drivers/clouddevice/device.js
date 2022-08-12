'use strict';

const Homey = require('homey');
const Particle = require('particle-api-js');

class CloudDevice extends Homey.Device {

  async onInit() {
    this.logMessage('Device initiated');

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

  logMessage(message) {
    this.log(`[${this.getName()}] ${message}`);
  }

  _startDeviceEventListener() {
    var self = this;
    if (this.generateDeviceEvents === 'yes') {
      self.logMessage('Starting device event listener');

      new Particle().getEventStream({ deviceId: this.device.id, auth: this.homey.settings.get('access_token') })
        .then(function (stream) {
          self.device.eventStream = stream;
          stream.on('event', function (event) {
            //self.logMessage(`Received event: '${event.name}' : '${event.data}'`);
            let particleEvent = {
              event_name: event.name || 'unknown',
              event_value: event.data || 'unknown'
            }
            self.driver.triggerDeviceFlow('device_event', particleEvent, self);
          });
        });
    }
  }

  _stopDeviceEventListener() {
    if (this.device.eventStream) {
      this.logMessage('Stopping device event listener');
      this.device.eventStream.abort();
      this.device.eventStream = undefined;
    }
  }

  _restartDeviceEventListener() {
    this._stopDeviceEventListener();
    this._startDeviceEventListener();
  }

  _initilializeTimers() {
    this.logMessage('Adding timers');
    // Start a poller, to check the device status
    this.pollIntervals.push(setInterval(() => {
      this.refreshCloudDeviceStatus();
    }, this.refresh_interval * 1000));

  }

  _deleteTimers() {
    //Kill interval object(s)
    this.logMessage('Removing timers');
    this.pollIntervals.forEach(timer => {
      clearInterval(timer);
    });
  }

  _reinitializeTimers() {
    this._deleteTimers();
    this._initilializeTimers();
  }

  onDeleted() {
    this.logMessage('Deleting device from Homey.');
    this._deleteTimers();
    this._stopDeviceEventListener();
    this.device = null;
  }

  onRenamed(name) {
    this.logMessage(`Renaming device from '${this.device.name}' to '${name}'`)
    this.device.name = name;
  }

  refreshCloudDeviceActionsAndVariables() {
    var self = this;
    this.logMessage('Refreshing device actions and variables');
    new Particle().getDevice({ deviceId: this.device.id, auth: this.homey.settings.get('access_token') })
      .then(function (data) {
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
        function (err) {
          self.logMessage('Failed to refresh device variables and functions: ', err);
        }
      );
  }

  getDeviceVariableValue(variableName) {
    //If device is offline then we cant invoke a function
    if (!this.device.info.connected) {
      return Promise.resolve(null);
    }

    return new Particle().getVariable({ deviceId: this.device.id, name: variableName, auth: this.homey.settings.get('access_token') })
      .then(function (data) {
        let value = null;
        if (data && data.body && data.body.result !== null) {
          value = data.body.result;
        }
        return value;
      }, function (err) {
        self.logMessage('Variable call failed: ', err);
        return null;
      });
  }

  callDeviceFunction(functionName, args) {
    //If device is offline then we cant invoke a function
    if (!this.device.info.connected) {
      return Promise.resolve({ statusCode: 400 });
    }

    var self = this;
    return new Particle().callFunction({ deviceId: this.device.id, name: functionName, argument: args, auth: this.homey.settings.get('access_token') })
      .then(function (data) {
        return data;
      }, function (err) {
        if (err.statusCode && err.statusCode === 400) {
          self.logMessage('Device most likely offline');
          self.logMessage(err.body);
        } else {
          self.error('Function call failed: ', err);
        }
        return Promise.resolve({ statusCode: err.statusCode || 500 });
      });
  }

  refreshCloudDeviceStatus() {
    var self = this;
    new Particle().getDevice({ deviceId: this.device.id, auth: this.homey.settings.get('access_token') })
      .then(function (data) {
          let device = data.body;
          //If connected change from false to true we should refresh variables and functions
          if (device.connected && self.isCapabilityValueChanged('connected', device.connected)) {
            self.logMessage('Device came online, lets refresh variables and functions');
            self.refreshCloudDeviceActionsAndVariables();
          }

          //Update capabilities of cloud device
          self._updateProperty('connected', device.connected);

          self.device.info = device;

          let lastHeardDate = new Date(device.last_heard)
            .toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });

          //Update Homey settings in advanced tab
          self.setSettings({
            serial_number: device.serial_number,
            firmware_version: device.system_firmware_version,
            last_ip_address: device.last_ip_address,
            last_heard: lastHeardDate
          })
            .catch(err => {
              self.error('failed to update settings', err);
            });

        },
        function (err) {
          self.error('Failed to refresh device status: ', err);
        }
      );
  }

  _updateProperty(key, value) {
    if (this.isCapabilityValueChanged(key, value)) {
      this.logMessage(`Updating capability '${key}' from '${this.getCapabilityValue(key)}' to '${value}'`);
      this.setCapabilityValue(key, value);

      let tokens = {};
      if (key == 'connected') {
        let flowDeviceTrigger = 'device_connected';
        let flowTrigger = 'a_device_connected';
        if (value === false) {
          flowDeviceTrigger = 'device_disconnected';
          flowTrigger = 'a_device_disconnected';
        }

        this.driver.triggerDeviceFlow(flowDeviceTrigger, tokens, this);

        tokens = {
          serial: this.getSettings().serial_number,
          name: this.getName(),
          ip_address: this.getSettings().last_ip_address
        }
        this.driver.triggerFlow(flowTrigger, tokens);
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

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.indexOf("refresh_interval") > -1) {
      this.logMessage(`Refresh interval value was change to '${ newSettings.refresh_interval }'`);
      this.refresh_interval = newSettings.refresh_interval;
      //We also need to re-initialize the timer
      this._reinitializeTimers();
    }

    if (changedKeys.indexOf("generate_device_events") > -1) {
      this.logMessage(`Generate device events was change to '${ newSettings.generate_device_events }'`);
      this.generateDeviceEvents = newSettings.generate_device_events;
      this._restartDeviceEventListener();
    }
  }

}

module.exports = CloudDevice;
