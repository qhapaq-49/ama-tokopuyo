'use strict';

var _pendingMessages = [];
var _evaluate = null;

var Module = {
  onRuntimeInitialized: function () {
    _evaluate = Module.cwrap('evaluate', 'string', ['string']);
    self.postMessage({ type: 'ready' });
    _pendingMessages.forEach(handleMessage);
    _pendingMessages = null;
  }
};

self.addEventListener('error', function (e) {
  self.postMessage({ type: 'init_error', message: e.message || String(e) });
});

function handleMessage(e) {
  var id = e.data.id;
  var input = e.data.input;
  try {
    var result = _evaluate(input);
    self.postMessage({ id: id, result: result });
  } catch (err) {
    self.postMessage({ id: id, error: String(err) });
  }
}

self.onmessage = function (e) {
  if (_evaluate) {
    handleMessage(e);
  } else {
    _pendingMessages.push(e);
  }
};

importScripts('ama.js');
