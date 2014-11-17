/* Let's fling! */

var Context = {
  devices: {},
  urlToFling: null,
  channel: null,
  title: null,
};

function log() {
  var msg = '';
  for (var i in arguments) {
    msg += arguments[i] + ' ';
  }
  dump('-*- Matchstick: ' + msg + '\n');
}

if (typeof String.prototype.replaceAll !== 'function') {
  String.prototype.replaceAll = function (AFindText, ARepText) {
    var raRegExp = new RegExp(AFindText, 'g');
    return this.replace(raRegExp, ARepText);
  }
}

var Protocol = function() {
  self = this;
  self.proto_load = {
    "requestId": "requestId-2",
    "data": '{"type": "LOAD","media": {"contentId": "##contentId##","contentType": "video/mp4","metadata": {"title": "##title##","subtitle": "##subtitle##"}}}'
  };

  self.proto_pause = {
    "requestId": "requestId-4",
    "data": '{"type": "PAUSE"}'
  };

  self.proto_play = {
    "requestId": "requestId-5",
    "data": '{"type": "PLAY"}'
  };
};

var listener = {
  onfound: function(device, url, ip) {
    if (url in Context.devices) {
      return;
    }

    document.getElementById('progress').setAttribute('hidden', 'hidden');
    document.getElementById('devices').removeAttribute('hidden');

    var friendlyName = device.querySelector('friendlyName').textContent;
    Context.devices[url] = friendlyName;
    var list = document.getElementById('device-list');
    var item = document.createElement('li');
    item.classList.add('device-list-item');
    item.setAttribute('data-url', url);
    item.setAttribute('data-ip', ip);
    item.textContent = friendlyName;
    item.addEventListener('click', onChooseDevice);
    list.appendChild(item);
  }
};

function updatePlayerUI() {
  var section = document.getElementById('player');
  if (Context.status) {
    section.removeAttribute('hidden');
  } else {
    section.setAttribute('hidden', 'hidden');
    return;
  }

  log('updatePlayerUI ' + JSON.stringify(Context.status));

  var button = document.getElementById('play');
  if (Context.status.state == 'PLAYING') {
    button.setAttribute('data-icon', 'pause');
  } else if (Context.status.state == 'PAUSED') {
    button.setAttribute('data-icon', 'play');
  }
}

function communicate() {
  Context.senderDaemon.on("appopened", function(messageChannel) {
    Context.channel = messageChannel;
    log('Channel opened');
    Context.channel.on("message", function(msg) {
      data = JSON.parse(msg["data"]);
      if (data.type == 'MEDIA_STATUS') {
        var status = data.status[0];
        log('Channel received ' + JSON.stringify(status));
        if (!Context.status) {
          document.getElementById('media-info').textContent =
            'You are watching ' + Context.title;
        }
        Context.status = {
          currentTime: status.currentTime,
          duration: status.duration,
          state: status.playerState
        }
        updatePlayerUI();
      } else {
        log('data type is ' + data.type);
      }
    });
    var protoLoad = new Protocol().proto_load;
    protoLoad["data"] = protoLoad["data"].replaceAll("##contentId##", Context.urlToFling)
        .replaceAll("##title##", Context.title)
        .replaceAll("##subtitle##", Context.title);
    Context.channel.send(JSON.stringify(protoLoad));
  });

  Context.senderDaemon.on('statereceived', function(msg) {
    log('State received: ' + JSON.stringify(msg));
  });
}

function ondisconnect() {
  log('Disconnected!');
  Context.senderDaemon = null;
  Context.channel = null;
  Context.status = null;
  document.getElementById('player').setAttribute('hidden', 'hidden');
  document.getElementById('media-info').textContent =
  'Choose a device to watch ' + Context.title;
}

function onChooseDevice(e) {
  log('Choosen device: ' + e.target.getAttribute('data-ip'));
  if (!Context.urlToFling) {
    log('Nothing to fling!');
    return;
  }

  var appUrl = 'http://openflint.github.io/flint-player/player.html';

  Context.senderDaemon = new SenderDaemon(e.target.getAttribute('data-ip'), '~flintplayer');
  communicate();
  Context.senderDaemon.openApp(appUrl, -1, true);
}

function onShare(activity) {
  log('onShare ' + JSON.stringify(activity.source.data));
  Context.urlToFling = activity.source.data.url;
  log('Available to fling: ' + Context.urlToFling);
  if (!Context.urlToFling) {
    log('Nothing to fling!');
    document.getElementById('info').setAttribute('hidden', 'hidden');
    return;
  }

  // If we get a Youtube url, do some magic to get the playable video url.
  // eg. http://m.youtube.com/watch?v=aKdV5FvXLuI
  if (Context.urlToFling.indexOf('youtube.com/watch') != -1) {
    var videoId = Context.urlToFling.substring(Context.urlToFling.indexOf('?') + 3);
    log('YouTube videoId is ' + videoId);
    getYoutubeVideo(videoId, function(url, title) {
      log('Youtube ' + url + ' (' + title + ')');
      Context.title = title;
      Context.urlToFling = url;
      document.getElementById('media-info').textContent =
        'Choose a device to watch ' + Context.title;
      document.getElementById('info').removeAttribute('hidden');
    }, function(error) {
      alert(error);
    })
  } else {
    Context.title = Context.urlToFling.split('/').reverse()[0].split('.')[0];
    document.getElementById('media-info').textContent =
      'Choose a device to watch ' + Context.title;
    document.getElementById('info').removeAttribute('hidden');
  }
}

var ssdp = new Ssdp();
ssdp.search('urn:dial-multiscreen-org:service:dial:1', listener);

navigator.mozSetMessageHandler('activity', onShare);

window.onunload = function(e) {
  if (Context.senderDaemon) {
    Context.senderDaemon.closeApp();
  }
}

document.getElementById('play').onclick = function(e) {
  if (!Context.status) {
    return;
  }

  if (Context.status.state == 'PLAYING') {
    var proto = new Protocol().proto_pause;
    Context.channel.send(JSON.stringify(proto));
  } else if (Context.status.state == 'PAUSED') {
    var proto = new Protocol().proto_play;
    Context.channel.send(JSON.stringify(proto));
  }
}

document.getElementById('stop').onclick = function(e) {
  if (!Context) {
    return;
  }

  Context.senderDaemon && Context.senderDaemon.closeApp();
  Context.channel && Context.channel.close();
  ondisconnect();
}