# Particle

Allows to connect your Particle.io devices to Homey.

Before adding a particle device you need to go to app settings and enter the API access token. If you don't know where to find the access token this [thread](https://community.particle.io/t/getting-finding-an-access-token/44084) my help.

Devices needs to be online in order to be added to Homey.

## Triggers
- Device connected/disconnected
- A device connected/disconnected
- Device events

   All events generated by the device are issued to Homey as a trigger. Filtering of relevant events needs to done by using conditions.

## Conditions
- Variable value

## Actions
- Call function
- Publish event

## Settings
- Refresh interval (seconds)

   How frequently the device information is refreshed from the particle cloud to Homey.

- Enable device events as a trigger

   By default the Device events trigger is disabled. If your device issues events that you want to use as a trigger for flows then you need to enable this setting.

# Disclaimer
Use this app at your own risk. The authors do not guaranteed the proper functioning of this app. This app use the standard Particle APIs using the standard Particle javascript [SDK](https://docs.particle.io/reference/SDKs/javascript/). However, it is possible that use of this app may cause unexpected damage for which nobody but you are responsible. Use of these functions can change the settings on your particle devices and may have negative consequences.
