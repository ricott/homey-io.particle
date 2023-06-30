'use strict';

const Homey = require('homey');
const Particle = require('particle-api-js');

class CloudDevice extends Homey.Device {

  async onInit() {
    this.logMessage('Device initiated');

    // Register device triggers
    this._device_connected = this.homey.flow.getDeviceTriggerCard('device_connected');
    this._device_disconnected = this.homey.flow.getDeviceTriggerCard('device_disconnected');
    this._device_event = this.homey.flow.getDeviceTriggerCard('device_event');

    this.device = {
      info: null,
      functions: [],
      variables: [],
      eventStream: null
    };

    this.refreshCloudDeviceActionsAndVariables();

    //Values are refreshed continously
    this.refreshCloudDeviceStatus();

    this._initilializeTimers();

    this._startDeviceEventListener(this.getSetting('generate_device_events'));
  }

  logMessage(message) {
    this.log(`[${this.getName()}] ${message}`);
  }

  _startDeviceEventListener(generateDeviceEvents) {
    var self = this;
    if (generateDeviceEvents === 'yes') {
      self.logMessage('Starting device event listener');

      new Particle().getEventStream({ deviceId: self.getData().id, auth: self.homey.settings.get('access_token') })
        .then(function (stream) {
          self.device.eventStream = stream;
          stream.on('event', function (event) {
            //self.logMessage(`Received event: '${event.name}' : '${event.data}'`);
            let particleEvent = {
              event_name: event.name || 'unknown',
              event_value: event.data || 'unknown'
            }
            self._device_event.trigger(self, particleEvent, {}).catch(error => { self.error(error) });
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

  _restartDeviceEventListener(generateDeviceEvents) {
    this._stopDeviceEventListener();
    this._startDeviceEventListener(generateDeviceEvents);
  }

  _initilializeTimers() {
    this.logMessage('Adding timers');
    // Start a poller, to check the device status
    this.homey.setInterval(() => {
      this.refreshCloudDeviceStatus();
    }, this.getSetting('refresh_interval') * 1000);
  }

  onDeleted() {
    this.logMessage('Deleting device from Homey.');
    this._stopDeviceEventListener();
    this.device = null;
  }

  refreshCloudDeviceActionsAndVariables() {
    var self = this;
    self.logMessage('Refreshing device actions and variables');
    new Particle().getDevice({ deviceId: self.getData().id, auth: self.homey.settings.get('access_token') })
      .then(function (data) {
        let device = data.body;
        let deviceVariables = [];
        if (device.variables) {
          Object.keys(device.variables).forEach(key => {
            deviceVariables.push({
              id: self.getData().id,
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
              id: self.getData().id,
              name: func,
              device_name: self.getName()
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

    return new Particle().getVariable({ deviceId: this.getData().id, name: variableName, auth: this.homey.settings.get('access_token') })
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
    var self = this;

    //If device is offline then we cant invoke a function
    if (!self.device.info.connected) {
      return Promise.resolve({ statusCode: 400 });
    }

    return new Particle().callFunction({ deviceId: self.getData().id, name: functionName, argument: args, auth: self.homey.settings.get('access_token') })
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
    new Particle().getDevice({ deviceId: self.getData().id, auth: self.homey.settings.get('access_token') })
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

        let flowTrigger;
        if (value === true) {
          this._device_connected.trigger(this, tokens, {}).catch(error => { this.error(error) });
          flowTrigger = 'a_device_connected';
        } else {
          this._device_disconnected.trigger(this, tokens, {}).catch(error => { this.error(error) });
          flowTrigger = 'a_device_disconnected';
        }

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
      this.logMessage(`Refresh interval value was change to '${newSettings.refresh_interval}'`);
    }

    if (changedKeys.indexOf("generate_device_events") > -1) {
      this.logMessage(`Generate device events was change to '${newSettings.generate_device_events}'`);
      this._restartDeviceEventListener(newSettings.generate_device_events);
    }
  }

}

module.exports = CloudDevice;
