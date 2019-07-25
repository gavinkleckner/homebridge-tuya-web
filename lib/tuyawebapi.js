const request = require('request');
const querystring = require('querystring');

class Session {
  constructor(accessToken, refreshToken, expiresIn) {
    this.accessToken;
    this.refreshToken;
    this.expiresOn;
    this.resetToken(accessToken, refreshToken, expiresIn);
  }

  resetToken(accessToken, refreshToken, expiresIn) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresOn = this._getCurrentEpoch() + expiresIn - 100; // subtract 100 ticks to expire token before it actually does
  }

  hasToken() {
    return this.accessToken && true;
  }

  isTokenExpired() {
    return this.token.expiresOn > this._getCurrentEpoch();
  }

  hasValidToken() {
    return this.accessToken && this.expiresOn > this._getCurrentEpoch();
  }

  _getCurrentEpoch() {
    return Math.round((new Date()).getTime() / 1000);
  }
}

class TuyaWebApi {
  constructor(username, password, countryCode, tuyaPlaform = 'tuya') {
    this.username = username;
    this.password = password;
    this.countryCode = countryCode;
    this.tuyaPlaform = tuyaPlaform;

    this.session = new Session();

    this.areaCode = 'eu';
    this.baseUrl = 'https://px1.tuyaeu.com';
  }

  discoverDevices() {
    if (!this.session.hasValidToken()) {
      throw new Error('No valid token');
    }

    var data = {
      'header': {
        'name': 'Discovery',
        'namespace': 'discovery',
        'payloadVersion': 1
      },
      'payload': {
        'accessToken': this.session.accessToken
      }
    }

    return new Promise((resolve, reject) => {
      this.sendRequestJson(
        this.baseUrl + '/homeassistant/skill',
        JSON.stringify(data),
        'GET',
        (response, obj) => {
          if (obj.header && obj.header.code === 'SUCCESS') {
            if (obj.payload && obj.payload.devices) {
              resolve(obj.payload.devices);
            }
          }
          reject(new Error('No valid response from API', obj));
        },
        (error) => {
          reject(error);
        }
      )
    });
  }

  getAllDeviceStates() {
    return this.discoverDevices();
  }

  getDeviceState(deviceId) {
    if (!this.session.hasValidToken()) {
      throw new Error('No valid token');
    }

    var data = {
      'header': {
        'name': 'QueryDevice',
        'namespace': 'query',
        'payloadVersion': 1
      },
      'payload': {
        'accessToken': this.session.accessToken,
        'devId': deviceId,
        'value': 1
      }
    }

    return new Promise((resolve, reject) => {
      this.sendRequestJson(
        this.baseUrl + '/homeassistant/skill',
        JSON.stringify(data),
        'GET',
        (response, obj) => {
          if (obj.payload && obj.header && obj.header.code === 'SUCCESS') {
            resolve(obj.payload.data);
          }
          else {
            reject(new Error('Invalid payload in response: ', obj))
          }
        },
        (error) => {
          reject(error);
        }
      )
    });
  }

  setDeviceState(deviceId, method, value) {
    if (!this.session.hasValidToken()) {
      throw new Error('No valid token');
    }

    /* Methods
     * turnOnOff -> 0 = off, 1 = on
     * brightnessSet --> 0..100 
    */

    var data = {
      'header': {
        'name': method,
        'namespace': 'control',
        'payloadVersion': 1
      },
      'payload': {
        'accessToken': this.session.accessToken,
        'devId': deviceId,
        'value': value
      }
    }

    return new Promise((resolve, reject) => {
      this.sendRequestJson(
        this.baseUrl + '/homeassistant/skill',
        JSON.stringify(data),
        'POST',
        (response, obj) => {
          if (obj.header && obj.header.code === 'SUCCESS') {
            resolve();
          }
          else {
            reject(new Error('Invalid payload in response: ', obj))
          }
        },
        (error) => {
          reject(error);
        }
      )
    });
  }

  getOrRefreshToken() {
    if (!this.session.hasToken()) {
      // No token, lets get a token from the Tuya Web API
      if (!this.username) {
        throw new Error('No username configured');
      }
      else {
        if (!this.password) {
          throw new Error('No password configured');
        }
        else {
          if (!this.countryCode) {
            throw new Error('No country code configured');
          }
          else {

            var form = {
              userName: this.username,
              password: this.password,
              countryCode: this.countryCode,
              bizType: this.tuyaPlaform,
              from: "tuya"
            }

            var formData = querystring.stringify(form);
            var contentLength = formData.length;

            return new Promise((resolve, reject) => {
              request({
                headers: {
                  'Content-Length': contentLength,
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                uri: this.baseUrl + '/homeassistant/auth.do',
                body: formData,
                method: 'POST'
              },
                (err, res, body) => {
                  if (err) {
                    reject(new Error('Authentication fault, could not retreive token.', error));
                  }
                  else {
                    let obj;
                    try {
                      obj = JSON.parse(body);
                    }
                    catch {
                      reject(new Error(`Could not parse json. Body: ${body}`, error));
                    }
                    // Received token
                    this.session.resetToken(
                      obj.access_token,
                      obj.refresh_token,
                      obj.expires_in
                    );
                    // TODO: change url based on accesstoken first two chars
                    // AY -> https://px1.tuyacn.com
                    // EU -> https://px1.tuyaeu.com
                    // US -> https://px1.tuyaus.com
                    resolve(this.session);
                  }
                });
            });
          }
        }
      }
    }
    else {
      if (this.session.hasToken() && this.session.isTokenExpired()) {
        // Refresh token
        return new Promise((resolve, reject) => {
          this.sendRequestJson(
            this.baseUrl + '/homeassistant/access.do?grant_type=refresh_token&refresh_token=' + this.session.refreshToken,
            '',
            'GET',
            (response, obj) => {
              // Received token
              this.session.resetToken(
                obj.access_token,
                obj.refresh_token,
                obj.expires_in
              );
              resolve(this.session);
            },
            (error) => {
              reject(error);
            }
          )
        });
      }
    }
  }

  /*
   * --------------------------------------
   * HTTP methods
  */

  sendRequest(url, body, method, callbackSuccess, callbackError) {
    request({
      url: url,
      body: body,
      method: method,
      rejectUnauthorized: false,
    },
      (error, response, body) => {
        if (error) {
          callbackError(error);
        }
        else {
          callbackSuccess(response, body)
        }
      });
  }

  sendRequestJson(url, body, method, callbackSuccess, callbackError) {
    this.sendRequest(url, body, method,
      (response, body) => {
        try {
          const obj = JSON.parse(body);
          callbackSuccess(response, obj);
        }
        catch (error) {
          callbackError(new Error(`Could not parse json. Body: ${body}`, error));
        }
      },
      (error) => {
        callbackError(error);
      }
    );
  }
}

module.exports = TuyaWebApi;