"use strict"

/*
*  Communicate with receiver
**/
var MessageChannel = function(wsURL){
    var self = this;
    var wsServer = wsURL;
    self.closeSignal = false;

    log("-------------------------------------------> sender channel wsServer: ", wsServer);
    var ws = new WebSocket(wsServer);
    ws.onopen = function (evt) {
        log("-------------------------------------> sender channel onopen");
        ("onopened" in self)&&(self.onopened());
    };
    ws.onclose = function (evt) {
        if(self.closeSignal){
            log("-------------------------------------> sender channel onclose");
        }else{
            setTimeout(function(){
                ws = new WebSocket(wsServer);
                log("-------------------------------------> sender channel reconnect");
            },50);
        }
    };
    ws.onmessage = function (evt) {
        log("-------------------------------------> sender channel onmessage evt.data : ", evt.data);
        if(evt.data){
            try{
                var msg = JSON.parse(evt.data);
                ("onmessage" in self)&&(msg)&&self.onmessage(msg);
            }catch(e){
                log("----------------------------> sender channel mesage error");
            }
        }
    };
    ws.onerror = function (evt) {
        log("-------------------------------------> sender channel onerror");
    };

    /*
    * Send message to sender
    * @param {String}
    * @param {String} sender id default is broadcast(*:*)
    **/
    self.send = function(data){
        if(ws&& ws.readyState==1){
            log('channel.send ' + data);
            ws.send(data);
        }else if(ws&& ws.readyState==0){
            setTimeout(function(){
                self.send(data);
            }, 50);
        }else{
            throw Error("Underlying websocket is not open");
        }
    };

    self.close = function(){
        self.closeSignal = true;
        ws.close();
    };

    self.on = function(type, func){
        self["on"+type] = func;
    }
};

/*
* Receiver Application state manager. This Class wrapper DIAL protocol.
**/
var SenderDaemon = function(deviceIp, appid){
    var self = this;
    var appUrl = "",
        maxInactive = -1;
    self.flingDConnected = false;
    self.token = null;
    self.useIpc = false;
    self.appHeartbeatInterval = null;
    self.appName = null;
    self.appState = null;
    self.appHref = null;
    self.additionalDatas = {};

    var wsServer = "ws://"+deviceIp+":9431/receiver/"+appid,
        ws = null,
        sender = {
            "count":0,
            "list":{}
        };

    self.simpleHttpRequest = function(method, headers, url, data, callback){
        log("url: ", url);
        var xhr = new XMLHttpRequest({mozSystem: true});
        xhr.open(method, url, true);
        if(headers){
            for (var i = headers.length - 1; i >= 0; i--) {
                xhr.setRequestHeader(headers[i][0], headers[i][1]);
            };
        }
        xhr.onreadystatechange = function() {
            if(xhr.readyState==4){
                if(xhr.status==200||xhr.status==201){
                    // log("--------------------------------->flingd resp: ", xhr.responseText);
                    if(callback){
                        callback(xhr.responseText);
                    }
                }else{
                    log("XmlHttpRequest Error", xhr.readyState, xhr.status);
                }
            }
        }
        xhr.onerror = function() {
            log('error');
        };
        xhr.timeout = 2000;
        if(data){
            xhr.send(JSON.stringify(data));
        }else{
            xhr.send();
        }
    };

    self.heartBeatLocked = false;
    /*
    * Private method, keep token alive.
    **/
    self._heartbeat = function(){
        if(self.flingDConnected&&self.useIpc&&!self.heartBeatLocked){
            self.heartBeatLocked = true;
            setTimeout(function(){
                var serverAddress = "http://"+deviceIp+":9431/apps/"+appid,
                    headers = [
                        ["Accept", "application/xml; charset=utf8"],
                        ["Authorization", self.token]
                    ];
                self.simpleHttpRequest("GET", headers, serverAddress, null, function(responseText){
                    self.heartBeatLocked = false;
                    self._heartbeat();
                });
            }, self.appHeartbeatInterval-100);
        }
    };
    /*
    * Launch receiver application
    * @param {String} receiver application url
    * @param {Integer} receiver running time. If maxInactive=-1 means forever
    * @param {Boolean} true means receive need connet to FlingService
    * @param {String} you can set launch/relaunch or join.
    **/
    self.launchApp = function(appUrl, maxInactive, useIpc, type){
        var serverAddress = "http://"+deviceIp+":9431/apps/"+appid,
            headers = [
                ["Content-Type","application/json"]
            ];
        if(!maxInactive){
            maxInactive = -1;
        }
        if(typeof(useIpc)=="undefined"){
            self.useIpc = true;
        }else{
            self.useIpc = useIpc;
        }
        if(typeof(type)=="undefined"){
            type = "launch";
        }
        var data = {
                type: type,
                app_info: {
                    url: appUrl,
                    useIpc: self.useIpc,
                    maxInactive: maxInactive
                }
            };
        self.flingDConnected = true;
        self.simpleHttpRequest("POST", headers, serverAddress, data, function(responseText){
            var resp = JSON.parse(responseText);
            self.token = resp["token"];
            self.appHeartbeatInterval = resp["interval"];
            ("onapplaunched" in self)&&(self.onapplaunched(resp));
        });
    };

    /*
    * Get Receiver Application status
    **/
    self.getState = function(){
        var serverAddress = "http://"+deviceIp+":9431/apps/"+appid,
            headers = [
                ["Accept", "application/xml; charset=utf8"],
                ["Authorization", self.token]
            ];

        self.simpleHttpRequest("GET", headers, serverAddress, null, function(responseText){
            log("----------------------------------responseText: ", responseText);
            var lines = responseText.split('\n');
            lines.splice(0,1);
            responseText = lines.join('');
            var parser = new DOMParser();
            var doc = parser.parseFromString(responseText,"text/xml");
            var additionalData = doc.getElementsByTagName("additionalData");
            if(additionalData.length==0){
                setTimeout(function(){
                    self.getState();
                }, 1000);
            }else{
                self.appName = doc.getElementsByTagName("name")[0].innerHTML;
                self.appState = doc.getElementsByTagName("state")[0].innerHTML;

                var link = doc.getElementsByTagName("link");
                if(link){
                    link = link[0];
                    self.appHref = link.getAttribute("href");
                }
                var items = additionalData[0].childNodes;
                if(items){
                    for(var i=0;i<items.length;i++){
                        if(items[i].tagName){
                            if(typeof(items[i].innerHTML)=="undefined"){
                                self.additionalDatas[items[i].tagName] = items[i].textContent;
                            }else{
                                self.additionalDatas[items[i].tagName] = items[i].innerHTML;
                            }
                        }
                    }
                }
            }
            ("onstatereceived" in self)&&(self.onstatereceived(self));
        });
    };

    /*
    * Disconnect with fling service
    **/
    self.disconnect = function(){
        var serverAddress = "http://"+deviceIp+":9431/apps/"+appid;
        self.simpleHttpRequest("DELETE", null, serverAddress, null, function(responseText){
            self.flingDConnected = false;
            ("onstoped" in self)&&(self.onstoped(self));
        });
    };

    /*
    * Stop the Receiver application
    **/
    self.closeApp = function(){
        if(self.appHref == null){
            self.appHref = "run";
        }
        var serverAddress = "http://"+deviceIp+":9431/apps/"+appid+"/"+self.appHref,
            headers = [
                    ["Accept", "application/xml; charset=utf8"],
                    ["Authorization", self.token]
                ];
        self.simpleHttpRequest("DELETE", headers, serverAddress, null, function(responseText){
            self.flingDConnected = false;
            ("onclosed" in self)&&(self.onstoped(self));
        });
    };

    self.systemControl = function(data){
        var serverAddress = "http://"+deviceIp+":9431/system/control";
        self.simpleHttpRequest("POST", null, serverAddress, data, function(responseText){
            if(callback){
                ("onsystemcontrol" in self)&&(self.onsystemcontrol(JSON.parse(responseText)));
            }
        });
    };

    //heigh level launch app interface
    self.openApp = function(appUrl, maxInactive, useIpc){
        self.on("applaunched", function(res){
            self.on("statereceived", function(data){
                if("additionalDatas" in data && "channelBaseUrl" in data["additionalDatas"]){
                    var channel = new MessageChannel(data["additionalDatas"]["channelBaseUrl"]+"/senders/"+self.token);
                    channel.on("opened",function(){
                        ("onappopened" in self)&&(self.onappopened(channel));
                    });
                }
                self._heartbeat();
            });
            self.getState();
        });
        self.launchApp(appUrl, maxInactive, useIpc);
    };

    self.on = function(type, func){
        self["on"+type] = func;
    }
};