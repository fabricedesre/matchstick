/**
  Simple ssdp implementation.
  */

(function(global) {

const SSDP_PORT = 1900;
const SSDP_ADDRESS = "239.255.255.250";
const SSDP_DISCOVER_MX = 5;

const SSDP_DISCOVER_PACKET =
  "M-SEARCH * HTTP/1.1\r\n" +
  "HOST: " + SSDP_ADDRESS + ":" + SSDP_PORT + "\r\n" +
  "MAN: \"ssdp:discover\"\r\n" +
  "MX: " + SSDP_DISCOVER_MX + "\r\n" +
  "ST: %SEARCH_TARGET%\r\n\r\n";

const SSDP_RESPONSE_HEADER = /HTTP\/\d{1}\.\d{1} \d+ .*/;

function Ssdp() {
  this.socket = null;
  this.listener = null;
}

Ssdp.prototype = {

  // Starts a search for device target type.
  search: function(target, listener) {

    this.listener = listener;

    // Creates our socket if needed.
    if (!this.socket) {
      this.socket = new UDPSocket({ loopback: true, localPort: SSDP_PORT });
      this.socket.joinMulticastGroup(SSDP_ADDRESS);
      this.socket.onmessage = this.onmessage.bind(this);
    }

    this.socket.opened.then((function() {
      // Performs a UDP broadcast to search for SSDP devices.
      var msgData = SSDP_DISCOVER_PACKET.replace('%SEARCH_TARGET%', target);
      var ok = this.socket.send(msgData, SSDP_ADDRESS, SSDP_PORT);
    }).bind(this));
  },

  // Receives data on the udp socket.
  onmessage: function(e) {
    var msg = String.fromCharCode.apply(null, new Uint8Array(e.data));
    var lines = msg.toString().split("\r\n");
    var firstLine = lines.shift();
    var method = SSDP_RESPONSE_HEADER.test(firstLine)
      ? 'RESPONSE' : firstLine.split(' ')[0].toUpperCase();
    var headers = {};
    lines.forEach(function(line) {
      if (line.length) {
        var pairs = line.match(/^([^:]+):\s*(.*)$/);
        if (pairs) {
          headers[pairs[1].toLowerCase()] = pairs[2];
        }
      }
    });

    if (headers.location) {
      this.getDeviceInfo(headers.location, e.remoteAddress);
    }
  },

  getDeviceInfo: function(url, ip) {
    var xhr = new XMLHttpRequest({ mozSystem: true });
    xhr.open('GET', url, true);
    xhr.overrideMimeType('text/xml');

    xhr.addEventListener('load', (function() {
      if (xhr.status == 200) {
        // Walk through root device and all the embedded devices.
        var devices = xhr.responseXML.querySelectorAll('device');
        for (var i = 0; i < devices.length; i++) {
          this.listener.onfound(devices[i], xhr.getResponseHeader('Application-URL'), ip);
        }
      }
    }).bind(this), false);

    xhr.send(null);
  }
};

global.Ssdp = Ssdp;

})(window);
