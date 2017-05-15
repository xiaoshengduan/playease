﻿(function(playease) {
	var utils = playease.utils,
		events = playease.events,
		net = playease.net,
		responder = net.responder,
		status = net.netstatus,
		netconnection = net.netconnection,
		netstream = net.netstream,
		core = playease.core,
		renders = core.renders,
		rendermodes = renders.modes,
		css = utils.css;
	
	renders.wss = function(layer, config) {
		var _this = utils.extend(this, new events.eventdispatcher('renders.wss')),
			_defaults = {},
			_video,
			_url,
			_src,
			_application,
			_streamname,
			_connection,
			_stream,
			_metadata,
			_ms,
			_sb,
			_segments,
			_endOfStream = false;
		
		function _init() {
			_this.name = rendermodes.WSS;
			
			_this.config = utils.extend({}, _defaults, config);
			
			_url = '';
			_src = '';
			
			_sb = { audio: null, video: null };
			_segments = { audio: [], video: [] };
			
			_video = utils.createElement('video');
			_video.playsinline = _video['webkit-playsinline'] = _this.config.playsinline;
			_video.poster = _this.config.poster;
			
			_video.addEventListener('durationchange', _onDurationChange);
			_video.addEventListener('ended', _onEnded);
			_video.addEventListener('error', _onError);
			
			_initNetConnection();
			_initMSE();
		}
		
		function _initNetConnection() {
			_connection = new netconnection();
			_connection.addEventListener(events.PLAYEASE_NET_STATUS, _statusHandler);
			_connection.addEventListener(events.PLAYEASE_SECURITY_ERROR, _errorHandler);
			_connection.addEventListener(events.PLAYEASE_IO_ERROR, _errorHandler);
			_connection.client = _this;
		}
		
		function _initNetStream() {
			_stream = new netstream(_connection);
			_stream.addEventListener(events.PLAYEASE_NET_STATUS, _statusHandler);
			_stream.addEventListener(events.PLAYEASE_MP4_INIT_SEGMENT, _onMP4InitSegment);
			_stream.addEventListener(events.PLAYEASE_MP4_SEGMENT, _onMP4Segment);
			_stream.addEventListener(events.PLAYEASE_IO_ERROR, _errorHandler);
			_stream.client = _this;
		}
		
		function _initMSE() {
			window.MediaSource = window.MediaSource || window.WebKitMediaSource;
			
			_ms = new MediaSource();
			_ms.addEventListener('sourceopen', _onMediaSourceOpen);
			_ms.addEventListener('sourceended', _onMediaSourceEnded);
			_ms.addEventListener('sourceclose', _onMediaSourceClose);
			_ms.addEventListener('error', _onMediaSourceError);
			
			_ms.addEventListener('webkitsourceopen', _onMediaSourceOpen);
			_ms.addEventListener('webkitsourceended', _onMediaSourceEnded);
			_ms.addEventListener('webkitsourceclose', _onMediaSourceClose);
			_ms.addEventListener('webkiterror', _onMediaSourceError);
		}
		
		_this.setup = function() {
			_this.dispatchEvent(events.PLAYEASE_READY, { id: _this.config.id });
		};
		
		function _statusHandler(e) {
			utils.log(e.info.code);
			
			switch (e.info.code) {
				case status.NETCONNECTION_CONNECT_SUCCESS:
					_this.play(_url);
					break;
					
				case status.NETCONNECTION_CONNECT_CLOSED:
					_this.dispatchEvent(events.PLAYEASE_VIEW_STOP);
					break;
			}
		}
		
		function _errorHandler(e) {
			utils.log(e.message);
			_this.dispatchEvent(events.PLAYEASE_VIEW_STOP);
		}
		
		_this.play = function(url) {
			if (!_video.src || _video.src !== _src || url && url != _url) {
				if (url && url != _url) {
					if (!renders.wss.isSupported(url)) {
						_this.dispatchEvent(events.PLAYEASE_RENDER_ERROR, { message: 'Resource not supported by render "' + _this.name + '".' });
						return;
					}
					
					_url = url;
				}
				
				if (!_connection.connected()) {
					var re = new RegExp('^(ws[s]?\:\/\/[a-z0-9\.\-]+(\:[0-9]+)?(\/[a-z0-9\.\-_]+)+)\/([a-z0-9\.\-_]+)$', 'i');
					var arr = _url.match(re);
					if (arr && arr.length > 4) {
						_application = arr[1];
						_streamname = arr[4];
					} else {
						utils.log('Failed to match wss URL: ' + _url);
						_this.dispatchEvent(events.PLAYEASE_RENDER_ERROR, { message: 'Bad URL format!' });
						return;
					}
					
					utils.log('Connecting to ' + _application + ' ...');
					_connection.connect(_application);
					
					return;
				}
				
				if (_stream) {
					_stream.dispose();
				}
				_segments.audio = [];
				_segments.video = [];
				
				_video.src = URL.createObjectURL(_ms);
				_video.load();
				
				_src = _video.src;
			}
			
			var promise = _video.play();
			if (promise) {
				promise['catch'](function(err) { /* void */ });
			}
		};
		
		_this.pause = function() {
			_video.pause();
			if (_stream) {
				_stream.pause();
			}
		};
		
		_this.reload = function() {
			_this.stop();
			_this.play(_url);
		};
		
		_this.seek = function(offset) {
			if (_video.duration === NaN) {
				_this.play();
			} else {
				if (_stream) {
					_stream.seek(offset * _video.duration / 100);
				}
			}
		};
		
		_this.stop = function() {
			if (_stream) {
				_stream.dispose();
			}
			_connection.close();
			
			_segments.audio = [];
			_segments.video = [];
			
			_src = '';
			_video.pause();
			_video.src = '';
		};
		
		_this.mute = function(muted) {
			_video.muted = muted;
		};
		
		_this.volume = function(vol) {
			_video.volume = vol / 100;
		};
		
		_this.hd = function(index) {
			
		};
		
		
		_this.onMetaData = function(data) {
			_metadata = data;
		};
		
		function _onMP4InitSegment(e) {
			_this.appendSegment(e.tp, e.data);
		}
		
		function _onMP4Segment(e) {
			_this.appendSegment(e.tp, e.data);
		}
		
		/**
		 * MSE
		 */
		_this.appendInitSegment = function(type, seg) {
			var mimetype = type + '/mp4; codecs="' + _metadata[type + 'Codec'] + '"';
			utils.log('Mime type: ' + mimetype + '.');
			
			var issurpported = MediaSource.isTypeSupported(mimetype);
			if (!issurpported) {
				_this.dispatchEvent(events.PLAYEASE_RENDER_ERROR, { message: 'Mime type is not surpported: ' + mimetype + '.' });
				return;
			}
			
			if (_ms.readyState == 'closed') {
				_this.dispatchEvent(events.PLAYEASE_RENDER_ERROR, { message: 'MediaSource is closed while appending init segment.' });
				return;
			}
			
			var sb = _sb[type] = _ms.addSourceBuffer(mimetype);
			sb.type = type;
			sb.addEventListener('updateend', _onUpdateEnd);
			sb.addEventListener('error', _onSourceBufferError);
			sb.appendBuffer(seg);
		};
		
		_this.appendSegment = function(type, seg) {
			_segments[type].push(seg);
			
			var sb = _sb[type];
			if (sb.updating) {
				return;
			}
			
			var seg = _segments[type].shift();
			sb.appendBuffer(seg);
		};
		
		function _onMediaSourceOpen(e) {
			utils.log('media source open');
			
			_initNetStream();
			_stream.play(_streamname);
		}
		
		function _onUpdateEnd(e) {
			utils.log('update end');
			
			var type = e.target.type;
			
			if (_endOfStream) {
				if (!_ms || _ms.readyState !== 'open') {
					return;
				}
				
				if (!_segments.audio.length && !_segments.video.length) {
					//_filekeeper.save();
					_ms.endOfStream();
					return;
				}
			}
			
			if (_segments[type].length == 0) {
				return;
			}
			
			var sb = _sb[type];
			if (sb.updating) {
				return;
			}
			
			var seg = _segments[type].shift();
			try {
				sb.appendBuffer(seg);
			} catch (err) {
				utils.log(err);
			}
		}
		
		function _onSourceBufferError(e) {
			utils.log('source buffer error');
		}
		
		function _onMediaSourceEnded(e) {
			utils.log('media source ended');
		}
		
		function _onMediaSourceClose(e) {
			utils.log('media source close');
		}
		
		function _onMediaSourceError(e) {
			utils.log('media source error');
		}
		
		
		_this.getRenderInfo = function() {
			var buffered;
			var position = _video.currentTime;
			var duration = _video.duration;
			
			var ranges = _video.buffered;
			for (var i = 0; i < ranges.length; i++) {
				var start = ranges.start(i);
				var end = ranges.end(i);
				if (start <= position && position < end) {
					buffered = duration ? Math.floor(end / _video.duration * 10000) / 100 : 0;
				}
			}
			
			return {
				buffered: buffered,
				position: position,
				duration: duration
			};
		};
		
		function _onDurationChange(e) {
			_this.dispatchEvent(events.PLAYEASE_DURATION, { duration: e.target.duration });
		}
		
		function _onEnded(e) {
			_this.dispatchEvent(events.PLAYEASE_VIEW_STOP);
		}
		
		function _onError(e) {
			//_this.dispatchEvent(events.PLAYEASE_RENDER_ERROR, { message: undefined });
		}
		
		_this.element = function() {
			return _video;
		};
		
		_this.resize = function(width, height) {
			
		};
		
		_this.destroy = function() {
			
		};
		
		_init();
	};
	
	renders.wss.isSupported = function(file) {
		var protocol = utils.getProtocol(file);
		if (protocol != 'ws' && protocol != 'wss') {
			return false;
		}
		
		if (utils.isMSIE(8) || utils.isMSIE(9) || utils.isIOS()) {
			return false;
		}
		
		var map = [
			undefined, // live stream
			'flv',
			'mp4', 'f4v', 'm4v', 'mov',
			'm4a', 'f4a', 'aac',
			'mp3'
		];
		var extension = utils.getExtension(file);
		for (var i = 0; i < map.length; i++) {
			if (extension === map[i]) {
				return true;
			}
		}
		
		return false;
	};
})(playease);
