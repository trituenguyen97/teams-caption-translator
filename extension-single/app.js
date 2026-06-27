(() => {
  // extension/lib/genai.mjs
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var require_retry_operation = __commonJS({
    "node_modules/retry/lib/retry_operation.js"(exports, module) {
      function RetryOperation(timeouts, options) {
        if (typeof options === "boolean") {
          options = { forever: options };
        }
        this._originalTimeouts = JSON.parse(JSON.stringify(timeouts));
        this._timeouts = timeouts;
        this._options = options || {};
        this._maxRetryTime = options && options.maxRetryTime || Infinity;
        this._fn = null;
        this._errors = [];
        this._attempts = 1;
        this._operationTimeout = null;
        this._operationTimeoutCb = null;
        this._timeout = null;
        this._operationStart = null;
        this._timer = null;
        if (this._options.forever) {
          this._cachedTimeouts = this._timeouts.slice(0);
        }
      }
      module.exports = RetryOperation;
      RetryOperation.prototype.reset = function() {
        this._attempts = 1;
        this._timeouts = this._originalTimeouts.slice(0);
      };
      RetryOperation.prototype.stop = function() {
        if (this._timeout) {
          clearTimeout(this._timeout);
        }
        if (this._timer) {
          clearTimeout(this._timer);
        }
        this._timeouts = [];
        this._cachedTimeouts = null;
      };
      RetryOperation.prototype.retry = function(err) {
        if (this._timeout) {
          clearTimeout(this._timeout);
        }
        if (!err) {
          return false;
        }
        var currentTime = (/* @__PURE__ */ new Date()).getTime();
        if (err && currentTime - this._operationStart >= this._maxRetryTime) {
          this._errors.push(err);
          this._errors.unshift(new Error("RetryOperation timeout occurred"));
          return false;
        }
        this._errors.push(err);
        var timeout = this._timeouts.shift();
        if (timeout === void 0) {
          if (this._cachedTimeouts) {
            this._errors.splice(0, this._errors.length - 1);
            timeout = this._cachedTimeouts.slice(-1);
          } else {
            return false;
          }
        }
        var self = this;
        this._timer = setTimeout(function() {
          self._attempts++;
          if (self._operationTimeoutCb) {
            self._timeout = setTimeout(function() {
              self._operationTimeoutCb(self._attempts);
            }, self._operationTimeout);
            if (self._options.unref) {
              self._timeout.unref();
            }
          }
          self._fn(self._attempts);
        }, timeout);
        if (this._options.unref) {
          this._timer.unref();
        }
        return true;
      };
      RetryOperation.prototype.attempt = function(fn, timeoutOps) {
        this._fn = fn;
        if (timeoutOps) {
          if (timeoutOps.timeout) {
            this._operationTimeout = timeoutOps.timeout;
          }
          if (timeoutOps.cb) {
            this._operationTimeoutCb = timeoutOps.cb;
          }
        }
        var self = this;
        if (this._operationTimeoutCb) {
          this._timeout = setTimeout(function() {
            self._operationTimeoutCb();
          }, self._operationTimeout);
        }
        this._operationStart = (/* @__PURE__ */ new Date()).getTime();
        this._fn(this._attempts);
      };
      RetryOperation.prototype.try = function(fn) {
        console.log("Using RetryOperation.try() is deprecated");
        this.attempt(fn);
      };
      RetryOperation.prototype.start = function(fn) {
        console.log("Using RetryOperation.start() is deprecated");
        this.attempt(fn);
      };
      RetryOperation.prototype.start = RetryOperation.prototype.try;
      RetryOperation.prototype.errors = function() {
        return this._errors;
      };
      RetryOperation.prototype.attempts = function() {
        return this._attempts;
      };
      RetryOperation.prototype.mainError = function() {
        if (this._errors.length === 0) {
          return null;
        }
        var counts = {};
        var mainError = null;
        var mainErrorCount = 0;
        for (var i = 0; i < this._errors.length; i++) {
          var error = this._errors[i];
          var message = error.message;
          var count = (counts[message] || 0) + 1;
          counts[message] = count;
          if (count >= mainErrorCount) {
            mainError = error;
            mainErrorCount = count;
          }
        }
        return mainError;
      };
    }
  });
  var require_retry = __commonJS({
    "node_modules/retry/lib/retry.js"(exports) {
      var RetryOperation = require_retry_operation();
      exports.operation = function(options) {
        var timeouts = exports.timeouts(options);
        return new RetryOperation(timeouts, {
          forever: options && (options.forever || options.retries === Infinity),
          unref: options && options.unref,
          maxRetryTime: options && options.maxRetryTime
        });
      };
      exports.timeouts = function(options) {
        if (options instanceof Array) {
          return [].concat(options);
        }
        var opts = {
          retries: 10,
          factor: 2,
          minTimeout: 1 * 1e3,
          maxTimeout: Infinity,
          randomize: false
        };
        for (var key in options) {
          opts[key] = options[key];
        }
        if (opts.minTimeout > opts.maxTimeout) {
          throw new Error("minTimeout is greater than maxTimeout");
        }
        var timeouts = [];
        for (var i = 0; i < opts.retries; i++) {
          timeouts.push(this.createTimeout(i, opts));
        }
        if (options && options.forever && !timeouts.length) {
          timeouts.push(this.createTimeout(i, opts));
        }
        timeouts.sort(function(a, b) {
          return a - b;
        });
        return timeouts;
      };
      exports.createTimeout = function(attempt, opts) {
        var random = opts.randomize ? Math.random() + 1 : 1;
        var timeout = Math.round(random * Math.max(opts.minTimeout, 1) * Math.pow(opts.factor, attempt));
        timeout = Math.min(timeout, opts.maxTimeout);
        return timeout;
      };
      exports.wrap = function(obj, options, methods) {
        if (options instanceof Array) {
          methods = options;
          options = null;
        }
        if (!methods) {
          methods = [];
          for (var key in obj) {
            if (typeof obj[key] === "function") {
              methods.push(key);
            }
          }
        }
        for (var i = 0; i < methods.length; i++) {
          var method = methods[i];
          var original = obj[method];
          obj[method] = function retryWrapper(original2) {
            var op = exports.operation(options);
            var args = Array.prototype.slice.call(arguments, 1);
            var callback = args.pop();
            args.push(function(err) {
              if (op.retry(err)) {
                return;
              }
              if (err) {
                arguments[0] = op.mainError();
              }
              callback.apply(this, arguments);
            });
            op.attempt(function() {
              original2.apply(obj, args);
            });
          }.bind(obj, original);
          obj[method].options = options;
        }
      };
    }
  });
  var require_retry2 = __commonJS({
    "node_modules/retry/index.js"(exports, module) {
      module.exports = require_retry();
    }
  });
  var require_p_retry = __commonJS({
    "node_modules/p-retry/index.js"(exports, module) {
      "use strict";
      var retry2 = require_retry2();
      var networkErrorMsgs = [
        "Failed to fetch",
        // Chrome
        "NetworkError when attempting to fetch resource.",
        // Firefox
        "The Internet connection appears to be offline.",
        // Safari
        "Network request failed"
        // `cross-fetch`
      ];
      var AbortError2 = class extends Error {
        constructor(message) {
          super();
          if (message instanceof Error) {
            this.originalError = message;
            ({ message } = message);
          } else {
            this.originalError = new Error(message);
            this.originalError.stack = this.stack;
          }
          this.name = "AbortError";
          this.message = message;
        }
      };
      var decorateErrorWithCounts = (error, attemptNumber, options) => {
        const retriesLeft = options.retries - (attemptNumber - 1);
        error.attemptNumber = attemptNumber;
        error.retriesLeft = retriesLeft;
        return error;
      };
      var isNetworkError = (errorMessage) => networkErrorMsgs.includes(errorMessage);
      var pRetry2 = (input, options) => new Promise((resolve, reject) => {
        options = {
          onFailedAttempt: () => {
          },
          retries: 10,
          ...options
        };
        const operation = retry2.operation(options);
        operation.attempt(async (attemptNumber) => {
          try {
            resolve(await input(attemptNumber));
          } catch (error) {
            if (!(error instanceof Error)) {
              reject(new TypeError(`Non-error was thrown: "${error}". You should only throw errors.`));
              return;
            }
            if (error instanceof AbortError2) {
              operation.stop();
              reject(error.originalError);
            } else if (error instanceof TypeError && !isNetworkError(error.message)) {
              operation.stop();
              reject(error);
            } else {
              decorateErrorWithCounts(error, attemptNumber, options);
              try {
                await options.onFailedAttempt(error);
              } catch (error2) {
                reject(error2);
                return;
              }
              if (!operation.retry(error)) {
                reject(operation.mainError());
              }
            }
          }
        });
      });
      module.exports = pRetry2;
      module.exports.default = pRetry2;
      module.exports.AbortError = AbortError2;
    }
  });
  var import_p_retry = __toESM(require_p_retry(), 1);
  var _defaultBaseGeminiUrl = void 0;
  var _defaultBaseVertexUrl = void 0;
  function getDefaultBaseUrls() {
    return {
      geminiUrl: _defaultBaseGeminiUrl,
      vertexUrl: _defaultBaseVertexUrl
    };
  }
  function getBaseUrl(httpOptions, vertexai, vertexBaseUrlFromEnv, geminiBaseUrlFromEnv) {
    var _a2, _b;
    if (!(httpOptions === null || httpOptions === void 0 ? void 0 : httpOptions.baseUrl)) {
      const defaultBaseUrls = getDefaultBaseUrls();
      if (vertexai) {
        return (_a2 = defaultBaseUrls.vertexUrl) !== null && _a2 !== void 0 ? _a2 : vertexBaseUrlFromEnv;
      } else {
        return (_b = defaultBaseUrls.geminiUrl) !== null && _b !== void 0 ? _b : geminiBaseUrlFromEnv;
      }
    }
    return httpOptions.baseUrl;
  }
  var BaseModule = class {
  };
  function formatMap(templateString, valueMap) {
    const regex = /\{([^}]+)\}/g;
    return templateString.replace(regex, (match2, key) => {
      if (Object.prototype.hasOwnProperty.call(valueMap, key)) {
        const value = valueMap[key];
        return value !== void 0 && value !== null ? String(value) : "";
      } else {
        throw new Error(`Key '${key}' not found in valueMap.`);
      }
    });
  }
  function setValueByPath(data, keys, value) {
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key.endsWith("[]")) {
        const keyName = key.slice(0, -2);
        if (!(keyName in data)) {
          if (Array.isArray(value)) {
            data[keyName] = Array.from({ length: value.length }, () => ({}));
          } else {
            throw new Error(`Value must be a list given an array path ${key}`);
          }
        }
        if (Array.isArray(data[keyName])) {
          const arrayData = data[keyName];
          if (Array.isArray(value)) {
            for (let j = 0; j < arrayData.length; j++) {
              const entry = arrayData[j];
              setValueByPath(entry, keys.slice(i + 1), value[j]);
            }
          } else {
            for (const d of arrayData) {
              setValueByPath(d, keys.slice(i + 1), value);
            }
          }
        }
        return;
      } else if (key.endsWith("[0]")) {
        const keyName = key.slice(0, -3);
        if (!(keyName in data)) {
          data[keyName] = [{}];
        }
        const arrayData = data[keyName];
        setValueByPath(arrayData[0], keys.slice(i + 1), value);
        return;
      }
      if (!data[key] || typeof data[key] !== "object") {
        data[key] = {};
      }
      data = data[key];
    }
    const keyToSet = keys[keys.length - 1];
    const existingData = data[keyToSet];
    if (existingData !== void 0) {
      if (!value || typeof value === "object" && Object.keys(value).length === 0) {
        return;
      }
      if (value === existingData) {
        return;
      }
      if (typeof existingData === "object" && typeof value === "object" && existingData !== null && value !== null) {
        Object.assign(existingData, value);
      } else {
        throw new Error(`Cannot set value for an existing key. Key: ${keyToSet}`);
      }
    } else {
      if (keyToSet === "_self" && typeof value === "object" && value !== null && !Array.isArray(value)) {
        const valueAsRecord = value;
        Object.assign(data, valueAsRecord);
      } else {
        data[keyToSet] = value;
      }
    }
  }
  function getValueByPath(data, keys, defaultValue = void 0) {
    try {
      if (keys.length === 1 && keys[0] === "_self") {
        return data;
      }
      for (let i = 0; i < keys.length; i++) {
        if (typeof data !== "object" || data === null) {
          return defaultValue;
        }
        const key = keys[i];
        if (key.endsWith("[]")) {
          const keyName = key.slice(0, -2);
          if (keyName in data) {
            const arrayData = data[keyName];
            if (!Array.isArray(arrayData)) {
              return defaultValue;
            }
            return arrayData.map((d) => getValueByPath(d, keys.slice(i + 1), defaultValue));
          } else {
            return defaultValue;
          }
        } else {
          data = data[key];
        }
      }
      return data;
    } catch (error) {
      if (error instanceof TypeError) {
        return defaultValue;
      }
      throw error;
    }
  }
  function moveValueByPath(data, paths) {
    for (const [sourcePath, destPath] of Object.entries(paths)) {
      const sourceKeys = sourcePath.split(".");
      const destKeys = destPath.split(".");
      const excludeKeys = /* @__PURE__ */ new Set();
      let wildcardIdx = -1;
      for (let i = 0; i < sourceKeys.length; i++) {
        if (sourceKeys[i] === "*") {
          wildcardIdx = i;
          break;
        }
      }
      if (wildcardIdx !== -1 && destKeys.length > wildcardIdx) {
        for (let i = wildcardIdx; i < destKeys.length; i++) {
          const key = destKeys[i];
          if (key !== "*" && !key.endsWith("[]") && !key.endsWith("[0]")) {
            excludeKeys.add(key);
          }
        }
      }
      _moveValueRecursive(data, sourceKeys, destKeys, 0, excludeKeys);
    }
  }
  function _moveValueRecursive(data, sourceKeys, destKeys, keyIdx, excludeKeys) {
    if (keyIdx >= sourceKeys.length) {
      return;
    }
    if (typeof data !== "object" || data === null) {
      return;
    }
    const key = sourceKeys[keyIdx];
    if (key.endsWith("[]")) {
      const keyName = key.slice(0, -2);
      const dataRecord = data;
      if (keyName in dataRecord && Array.isArray(dataRecord[keyName])) {
        for (const item of dataRecord[keyName]) {
          _moveValueRecursive(item, sourceKeys, destKeys, keyIdx + 1, excludeKeys);
        }
      }
    } else if (key === "*") {
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        const dataRecord = data;
        const keysToMove = Object.keys(dataRecord).filter((k) => !k.startsWith("_") && !excludeKeys.has(k));
        const valuesToMove = {};
        for (const k of keysToMove) {
          valuesToMove[k] = dataRecord[k];
        }
        for (const [k, v] of Object.entries(valuesToMove)) {
          const newDestKeys = [];
          for (const dk of destKeys.slice(keyIdx)) {
            if (dk === "*") {
              newDestKeys.push(k);
            } else {
              newDestKeys.push(dk);
            }
          }
          setValueByPath(dataRecord, newDestKeys, v);
        }
        for (const k of keysToMove) {
          delete dataRecord[k];
        }
      }
    } else {
      const dataRecord = data;
      if (key in dataRecord) {
        _moveValueRecursive(dataRecord[key], sourceKeys, destKeys, keyIdx + 1, excludeKeys);
      }
    }
  }
  function tBytes$1(fromBytes) {
    if (typeof fromBytes !== "string") {
      throw new Error("fromImageBytes must be a string");
    }
    return fromBytes;
  }
  function fetchPredictOperationParametersToVertex(fromObject) {
    const toObject = {};
    const fromOperationName = getValueByPath(fromObject, [
      "operationName"
    ]);
    if (fromOperationName != null) {
      setValueByPath(toObject, ["operationName"], fromOperationName);
    }
    const fromResourceName = getValueByPath(fromObject, ["resourceName"]);
    if (fromResourceName != null) {
      setValueByPath(toObject, ["_url", "resourceName"], fromResourceName);
    }
    return toObject;
  }
  function generateVideosOperationFromMldev$1(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromResponse = getValueByPath(fromObject, [
      "response",
      "generateVideoResponse"
    ]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], generateVideosResponseFromMldev$1(fromResponse));
    }
    return toObject;
  }
  function generateVideosOperationFromVertex$1(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromResponse = getValueByPath(fromObject, ["response"]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], generateVideosResponseFromVertex$1(fromResponse));
    }
    return toObject;
  }
  function generateVideosResponseFromMldev$1(fromObject) {
    const toObject = {};
    const fromGeneratedVideos = getValueByPath(fromObject, [
      "generatedSamples"
    ]);
    if (fromGeneratedVideos != null) {
      let transformedList = fromGeneratedVideos;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedVideoFromMldev$1(item);
        });
      }
      setValueByPath(toObject, ["generatedVideos"], transformedList);
    }
    const fromRaiMediaFilteredCount = getValueByPath(fromObject, [
      "raiMediaFilteredCount"
    ]);
    if (fromRaiMediaFilteredCount != null) {
      setValueByPath(toObject, ["raiMediaFilteredCount"], fromRaiMediaFilteredCount);
    }
    const fromRaiMediaFilteredReasons = getValueByPath(fromObject, [
      "raiMediaFilteredReasons"
    ]);
    if (fromRaiMediaFilteredReasons != null) {
      setValueByPath(toObject, ["raiMediaFilteredReasons"], fromRaiMediaFilteredReasons);
    }
    return toObject;
  }
  function generateVideosResponseFromVertex$1(fromObject) {
    const toObject = {};
    const fromGeneratedVideos = getValueByPath(fromObject, ["videos"]);
    if (fromGeneratedVideos != null) {
      let transformedList = fromGeneratedVideos;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedVideoFromVertex$1(item);
        });
      }
      setValueByPath(toObject, ["generatedVideos"], transformedList);
    }
    const fromRaiMediaFilteredCount = getValueByPath(fromObject, [
      "raiMediaFilteredCount"
    ]);
    if (fromRaiMediaFilteredCount != null) {
      setValueByPath(toObject, ["raiMediaFilteredCount"], fromRaiMediaFilteredCount);
    }
    const fromRaiMediaFilteredReasons = getValueByPath(fromObject, [
      "raiMediaFilteredReasons"
    ]);
    if (fromRaiMediaFilteredReasons != null) {
      setValueByPath(toObject, ["raiMediaFilteredReasons"], fromRaiMediaFilteredReasons);
    }
    return toObject;
  }
  function generatedVideoFromMldev$1(fromObject) {
    const toObject = {};
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["video"], videoFromMldev$1(fromVideo));
    }
    return toObject;
  }
  function generatedVideoFromVertex$1(fromObject) {
    const toObject = {};
    const fromVideo = getValueByPath(fromObject, ["_self"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["video"], videoFromVertex$1(fromVideo));
    }
    return toObject;
  }
  function getOperationParametersToMldev(fromObject) {
    const toObject = {};
    const fromOperationName = getValueByPath(fromObject, [
      "operationName"
    ]);
    if (fromOperationName != null) {
      setValueByPath(toObject, ["_url", "operationName"], fromOperationName);
    }
    return toObject;
  }
  function getOperationParametersToVertex(fromObject) {
    const toObject = {};
    const fromOperationName = getValueByPath(fromObject, [
      "operationName"
    ]);
    if (fromOperationName != null) {
      setValueByPath(toObject, ["_url", "operationName"], fromOperationName);
    }
    return toObject;
  }
  function importFileOperationFromMldev$1(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromResponse = getValueByPath(fromObject, ["response"]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], importFileResponseFromMldev$1(fromResponse));
    }
    return toObject;
  }
  function importFileResponseFromMldev$1(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromParent = getValueByPath(fromObject, ["parent"]);
    if (fromParent != null) {
      setValueByPath(toObject, ["parent"], fromParent);
    }
    const fromDocumentName = getValueByPath(fromObject, ["documentName"]);
    if (fromDocumentName != null) {
      setValueByPath(toObject, ["documentName"], fromDocumentName);
    }
    return toObject;
  }
  function uploadToFileSearchStoreOperationFromMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromResponse = getValueByPath(fromObject, ["response"]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], uploadToFileSearchStoreResponseFromMldev(fromResponse));
    }
    return toObject;
  }
  function uploadToFileSearchStoreResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromParent = getValueByPath(fromObject, ["parent"]);
    if (fromParent != null) {
      setValueByPath(toObject, ["parent"], fromParent);
    }
    const fromDocumentName = getValueByPath(fromObject, ["documentName"]);
    if (fromDocumentName != null) {
      setValueByPath(toObject, ["documentName"], fromDocumentName);
    }
    return toObject;
  }
  function videoFromMldev$1(fromObject) {
    const toObject = {};
    const fromUri = getValueByPath(fromObject, ["uri"]);
    if (fromUri != null) {
      setValueByPath(toObject, ["uri"], fromUri);
    }
    const fromVideoBytes = getValueByPath(fromObject, ["encodedVideo"]);
    if (fromVideoBytes != null) {
      setValueByPath(toObject, ["videoBytes"], tBytes$1(fromVideoBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["encoding"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function videoFromVertex$1(fromObject) {
    const toObject = {};
    const fromUri = getValueByPath(fromObject, ["gcsUri"]);
    if (fromUri != null) {
      setValueByPath(toObject, ["uri"], fromUri);
    }
    const fromVideoBytes = getValueByPath(fromObject, [
      "bytesBase64Encoded"
    ]);
    if (fromVideoBytes != null) {
      setValueByPath(toObject, ["videoBytes"], tBytes$1(fromVideoBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  var Outcome;
  (function(Outcome2) {
    Outcome2["OUTCOME_UNSPECIFIED"] = "OUTCOME_UNSPECIFIED";
    Outcome2["OUTCOME_OK"] = "OUTCOME_OK";
    Outcome2["OUTCOME_FAILED"] = "OUTCOME_FAILED";
    Outcome2["OUTCOME_DEADLINE_EXCEEDED"] = "OUTCOME_DEADLINE_EXCEEDED";
  })(Outcome || (Outcome = {}));
  var Language;
  (function(Language2) {
    Language2["LANGUAGE_UNSPECIFIED"] = "LANGUAGE_UNSPECIFIED";
    Language2["PYTHON"] = "PYTHON";
  })(Language || (Language = {}));
  var FunctionResponseScheduling;
  (function(FunctionResponseScheduling2) {
    FunctionResponseScheduling2["SCHEDULING_UNSPECIFIED"] = "SCHEDULING_UNSPECIFIED";
    FunctionResponseScheduling2["SILENT"] = "SILENT";
    FunctionResponseScheduling2["WHEN_IDLE"] = "WHEN_IDLE";
    FunctionResponseScheduling2["INTERRUPT"] = "INTERRUPT";
  })(FunctionResponseScheduling || (FunctionResponseScheduling = {}));
  var Type;
  (function(Type2) {
    Type2["TYPE_UNSPECIFIED"] = "TYPE_UNSPECIFIED";
    Type2["STRING"] = "STRING";
    Type2["NUMBER"] = "NUMBER";
    Type2["INTEGER"] = "INTEGER";
    Type2["BOOLEAN"] = "BOOLEAN";
    Type2["ARRAY"] = "ARRAY";
    Type2["OBJECT"] = "OBJECT";
    Type2["NULL"] = "NULL";
  })(Type || (Type = {}));
  var Environment;
  (function(Environment2) {
    Environment2["ENVIRONMENT_UNSPECIFIED"] = "ENVIRONMENT_UNSPECIFIED";
    Environment2["ENVIRONMENT_BROWSER"] = "ENVIRONMENT_BROWSER";
    Environment2["ENVIRONMENT_MOBILE"] = "ENVIRONMENT_MOBILE";
    Environment2["ENVIRONMENT_DESKTOP"] = "ENVIRONMENT_DESKTOP";
  })(Environment || (Environment = {}));
  var AuthType;
  (function(AuthType2) {
    AuthType2["AUTH_TYPE_UNSPECIFIED"] = "AUTH_TYPE_UNSPECIFIED";
    AuthType2["NO_AUTH"] = "NO_AUTH";
    AuthType2["API_KEY_AUTH"] = "API_KEY_AUTH";
    AuthType2["HTTP_BASIC_AUTH"] = "HTTP_BASIC_AUTH";
    AuthType2["GOOGLE_SERVICE_ACCOUNT_AUTH"] = "GOOGLE_SERVICE_ACCOUNT_AUTH";
    AuthType2["OAUTH"] = "OAUTH";
    AuthType2["OIDC_AUTH"] = "OIDC_AUTH";
  })(AuthType || (AuthType = {}));
  var HttpElementLocation;
  (function(HttpElementLocation2) {
    HttpElementLocation2["HTTP_IN_UNSPECIFIED"] = "HTTP_IN_UNSPECIFIED";
    HttpElementLocation2["HTTP_IN_QUERY"] = "HTTP_IN_QUERY";
    HttpElementLocation2["HTTP_IN_HEADER"] = "HTTP_IN_HEADER";
    HttpElementLocation2["HTTP_IN_PATH"] = "HTTP_IN_PATH";
    HttpElementLocation2["HTTP_IN_BODY"] = "HTTP_IN_BODY";
    HttpElementLocation2["HTTP_IN_COOKIE"] = "HTTP_IN_COOKIE";
  })(HttpElementLocation || (HttpElementLocation = {}));
  var ApiSpec;
  (function(ApiSpec2) {
    ApiSpec2["API_SPEC_UNSPECIFIED"] = "API_SPEC_UNSPECIFIED";
    ApiSpec2["SIMPLE_SEARCH"] = "SIMPLE_SEARCH";
    ApiSpec2["ELASTIC_SEARCH"] = "ELASTIC_SEARCH";
  })(ApiSpec || (ApiSpec = {}));
  var PhishBlockThreshold;
  (function(PhishBlockThreshold2) {
    PhishBlockThreshold2["PHISH_BLOCK_THRESHOLD_UNSPECIFIED"] = "PHISH_BLOCK_THRESHOLD_UNSPECIFIED";
    PhishBlockThreshold2["BLOCK_LOW_AND_ABOVE"] = "BLOCK_LOW_AND_ABOVE";
    PhishBlockThreshold2["BLOCK_MEDIUM_AND_ABOVE"] = "BLOCK_MEDIUM_AND_ABOVE";
    PhishBlockThreshold2["BLOCK_HIGH_AND_ABOVE"] = "BLOCK_HIGH_AND_ABOVE";
    PhishBlockThreshold2["BLOCK_HIGHER_AND_ABOVE"] = "BLOCK_HIGHER_AND_ABOVE";
    PhishBlockThreshold2["BLOCK_VERY_HIGH_AND_ABOVE"] = "BLOCK_VERY_HIGH_AND_ABOVE";
    PhishBlockThreshold2["BLOCK_ONLY_EXTREMELY_HIGH"] = "BLOCK_ONLY_EXTREMELY_HIGH";
  })(PhishBlockThreshold || (PhishBlockThreshold = {}));
  var Behavior;
  (function(Behavior2) {
    Behavior2["UNSPECIFIED"] = "UNSPECIFIED";
    Behavior2["BLOCKING"] = "BLOCKING";
    Behavior2["NON_BLOCKING"] = "NON_BLOCKING";
  })(Behavior || (Behavior = {}));
  var DynamicRetrievalConfigMode;
  (function(DynamicRetrievalConfigMode2) {
    DynamicRetrievalConfigMode2["MODE_UNSPECIFIED"] = "MODE_UNSPECIFIED";
    DynamicRetrievalConfigMode2["MODE_DYNAMIC"] = "MODE_DYNAMIC";
  })(DynamicRetrievalConfigMode || (DynamicRetrievalConfigMode = {}));
  var ThinkingLevel;
  (function(ThinkingLevel2) {
    ThinkingLevel2["THINKING_LEVEL_UNSPECIFIED"] = "THINKING_LEVEL_UNSPECIFIED";
    ThinkingLevel2["MINIMAL"] = "MINIMAL";
    ThinkingLevel2["LOW"] = "LOW";
    ThinkingLevel2["MEDIUM"] = "MEDIUM";
    ThinkingLevel2["HIGH"] = "HIGH";
  })(ThinkingLevel || (ThinkingLevel = {}));
  var PersonGeneration;
  (function(PersonGeneration2) {
    PersonGeneration2["DONT_ALLOW"] = "DONT_ALLOW";
    PersonGeneration2["ALLOW_ADULT"] = "ALLOW_ADULT";
    PersonGeneration2["ALLOW_ALL"] = "ALLOW_ALL";
  })(PersonGeneration || (PersonGeneration = {}));
  var ProminentPeople;
  (function(ProminentPeople2) {
    ProminentPeople2["PROMINENT_PEOPLE_UNSPECIFIED"] = "PROMINENT_PEOPLE_UNSPECIFIED";
    ProminentPeople2["ALLOW_PROMINENT_PEOPLE"] = "ALLOW_PROMINENT_PEOPLE";
    ProminentPeople2["BLOCK_PROMINENT_PEOPLE"] = "BLOCK_PROMINENT_PEOPLE";
  })(ProminentPeople || (ProminentPeople = {}));
  var HarmCategory;
  (function(HarmCategory2) {
    HarmCategory2["HARM_CATEGORY_UNSPECIFIED"] = "HARM_CATEGORY_UNSPECIFIED";
    HarmCategory2["HARM_CATEGORY_HARASSMENT"] = "HARM_CATEGORY_HARASSMENT";
    HarmCategory2["HARM_CATEGORY_HATE_SPEECH"] = "HARM_CATEGORY_HATE_SPEECH";
    HarmCategory2["HARM_CATEGORY_SEXUALLY_EXPLICIT"] = "HARM_CATEGORY_SEXUALLY_EXPLICIT";
    HarmCategory2["HARM_CATEGORY_DANGEROUS_CONTENT"] = "HARM_CATEGORY_DANGEROUS_CONTENT";
    HarmCategory2["HARM_CATEGORY_CIVIC_INTEGRITY"] = "HARM_CATEGORY_CIVIC_INTEGRITY";
    HarmCategory2["HARM_CATEGORY_IMAGE_HATE"] = "HARM_CATEGORY_IMAGE_HATE";
    HarmCategory2["HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT"] = "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT";
    HarmCategory2["HARM_CATEGORY_IMAGE_HARASSMENT"] = "HARM_CATEGORY_IMAGE_HARASSMENT";
    HarmCategory2["HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT"] = "HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT";
    HarmCategory2["HARM_CATEGORY_JAILBREAK"] = "HARM_CATEGORY_JAILBREAK";
  })(HarmCategory || (HarmCategory = {}));
  var HarmBlockMethod;
  (function(HarmBlockMethod2) {
    HarmBlockMethod2["HARM_BLOCK_METHOD_UNSPECIFIED"] = "HARM_BLOCK_METHOD_UNSPECIFIED";
    HarmBlockMethod2["SEVERITY"] = "SEVERITY";
    HarmBlockMethod2["PROBABILITY"] = "PROBABILITY";
  })(HarmBlockMethod || (HarmBlockMethod = {}));
  var HarmBlockThreshold;
  (function(HarmBlockThreshold2) {
    HarmBlockThreshold2["HARM_BLOCK_THRESHOLD_UNSPECIFIED"] = "HARM_BLOCK_THRESHOLD_UNSPECIFIED";
    HarmBlockThreshold2["BLOCK_LOW_AND_ABOVE"] = "BLOCK_LOW_AND_ABOVE";
    HarmBlockThreshold2["BLOCK_MEDIUM_AND_ABOVE"] = "BLOCK_MEDIUM_AND_ABOVE";
    HarmBlockThreshold2["BLOCK_ONLY_HIGH"] = "BLOCK_ONLY_HIGH";
    HarmBlockThreshold2["BLOCK_NONE"] = "BLOCK_NONE";
    HarmBlockThreshold2["OFF"] = "OFF";
  })(HarmBlockThreshold || (HarmBlockThreshold = {}));
  var FunctionCallingConfigMode;
  (function(FunctionCallingConfigMode2) {
    FunctionCallingConfigMode2["MODE_UNSPECIFIED"] = "MODE_UNSPECIFIED";
    FunctionCallingConfigMode2["AUTO"] = "AUTO";
    FunctionCallingConfigMode2["ANY"] = "ANY";
    FunctionCallingConfigMode2["NONE"] = "NONE";
    FunctionCallingConfigMode2["VALIDATED"] = "VALIDATED";
  })(FunctionCallingConfigMode || (FunctionCallingConfigMode = {}));
  var FinishReason;
  (function(FinishReason2) {
    FinishReason2["FINISH_REASON_UNSPECIFIED"] = "FINISH_REASON_UNSPECIFIED";
    FinishReason2["STOP"] = "STOP";
    FinishReason2["MAX_TOKENS"] = "MAX_TOKENS";
    FinishReason2["SAFETY"] = "SAFETY";
    FinishReason2["RECITATION"] = "RECITATION";
    FinishReason2["LANGUAGE"] = "LANGUAGE";
    FinishReason2["OTHER"] = "OTHER";
    FinishReason2["BLOCKLIST"] = "BLOCKLIST";
    FinishReason2["PROHIBITED_CONTENT"] = "PROHIBITED_CONTENT";
    FinishReason2["SPII"] = "SPII";
    FinishReason2["MALFORMED_FUNCTION_CALL"] = "MALFORMED_FUNCTION_CALL";
    FinishReason2["IMAGE_SAFETY"] = "IMAGE_SAFETY";
    FinishReason2["UNEXPECTED_TOOL_CALL"] = "UNEXPECTED_TOOL_CALL";
    FinishReason2["IMAGE_PROHIBITED_CONTENT"] = "IMAGE_PROHIBITED_CONTENT";
    FinishReason2["NO_IMAGE"] = "NO_IMAGE";
    FinishReason2["IMAGE_RECITATION"] = "IMAGE_RECITATION";
    FinishReason2["IMAGE_OTHER"] = "IMAGE_OTHER";
  })(FinishReason || (FinishReason = {}));
  var HarmProbability;
  (function(HarmProbability2) {
    HarmProbability2["HARM_PROBABILITY_UNSPECIFIED"] = "HARM_PROBABILITY_UNSPECIFIED";
    HarmProbability2["NEGLIGIBLE"] = "NEGLIGIBLE";
    HarmProbability2["LOW"] = "LOW";
    HarmProbability2["MEDIUM"] = "MEDIUM";
    HarmProbability2["HIGH"] = "HIGH";
  })(HarmProbability || (HarmProbability = {}));
  var HarmSeverity;
  (function(HarmSeverity2) {
    HarmSeverity2["HARM_SEVERITY_UNSPECIFIED"] = "HARM_SEVERITY_UNSPECIFIED";
    HarmSeverity2["HARM_SEVERITY_NEGLIGIBLE"] = "HARM_SEVERITY_NEGLIGIBLE";
    HarmSeverity2["HARM_SEVERITY_LOW"] = "HARM_SEVERITY_LOW";
    HarmSeverity2["HARM_SEVERITY_MEDIUM"] = "HARM_SEVERITY_MEDIUM";
    HarmSeverity2["HARM_SEVERITY_HIGH"] = "HARM_SEVERITY_HIGH";
  })(HarmSeverity || (HarmSeverity = {}));
  var UrlRetrievalStatus;
  (function(UrlRetrievalStatus2) {
    UrlRetrievalStatus2["URL_RETRIEVAL_STATUS_UNSPECIFIED"] = "URL_RETRIEVAL_STATUS_UNSPECIFIED";
    UrlRetrievalStatus2["URL_RETRIEVAL_STATUS_SUCCESS"] = "URL_RETRIEVAL_STATUS_SUCCESS";
    UrlRetrievalStatus2["URL_RETRIEVAL_STATUS_ERROR"] = "URL_RETRIEVAL_STATUS_ERROR";
    UrlRetrievalStatus2["URL_RETRIEVAL_STATUS_PAYWALL"] = "URL_RETRIEVAL_STATUS_PAYWALL";
    UrlRetrievalStatus2["URL_RETRIEVAL_STATUS_UNSAFE"] = "URL_RETRIEVAL_STATUS_UNSAFE";
  })(UrlRetrievalStatus || (UrlRetrievalStatus = {}));
  var BlockedReason;
  (function(BlockedReason2) {
    BlockedReason2["BLOCKED_REASON_UNSPECIFIED"] = "BLOCKED_REASON_UNSPECIFIED";
    BlockedReason2["SAFETY"] = "SAFETY";
    BlockedReason2["OTHER"] = "OTHER";
    BlockedReason2["BLOCKLIST"] = "BLOCKLIST";
    BlockedReason2["PROHIBITED_CONTENT"] = "PROHIBITED_CONTENT";
    BlockedReason2["IMAGE_SAFETY"] = "IMAGE_SAFETY";
    BlockedReason2["MODEL_ARMOR"] = "MODEL_ARMOR";
    BlockedReason2["JAILBREAK"] = "JAILBREAK";
  })(BlockedReason || (BlockedReason = {}));
  var TrafficType;
  (function(TrafficType2) {
    TrafficType2["TRAFFIC_TYPE_UNSPECIFIED"] = "TRAFFIC_TYPE_UNSPECIFIED";
    TrafficType2["ON_DEMAND"] = "ON_DEMAND";
    TrafficType2["ON_DEMAND_PRIORITY"] = "ON_DEMAND_PRIORITY";
    TrafficType2["ON_DEMAND_FLEX"] = "ON_DEMAND_FLEX";
    TrafficType2["PROVISIONED_THROUGHPUT"] = "PROVISIONED_THROUGHPUT";
  })(TrafficType || (TrafficType = {}));
  var MediaModality;
  (function(MediaModality2) {
    MediaModality2["MODALITY_UNSPECIFIED"] = "MODALITY_UNSPECIFIED";
    MediaModality2["TEXT"] = "TEXT";
    MediaModality2["IMAGE"] = "IMAGE";
    MediaModality2["VIDEO"] = "VIDEO";
    MediaModality2["AUDIO"] = "AUDIO";
    MediaModality2["DOCUMENT"] = "DOCUMENT";
  })(MediaModality || (MediaModality = {}));
  var ModelStage;
  (function(ModelStage2) {
    ModelStage2["MODEL_STAGE_UNSPECIFIED"] = "MODEL_STAGE_UNSPECIFIED";
    ModelStage2["UNSTABLE_EXPERIMENTAL"] = "UNSTABLE_EXPERIMENTAL";
    ModelStage2["EXPERIMENTAL"] = "EXPERIMENTAL";
    ModelStage2["PREVIEW"] = "PREVIEW";
    ModelStage2["STABLE"] = "STABLE";
    ModelStage2["LEGACY"] = "LEGACY";
    ModelStage2["DEPRECATED"] = "DEPRECATED";
    ModelStage2["RETIRED"] = "RETIRED";
  })(ModelStage || (ModelStage = {}));
  var MediaResolution;
  (function(MediaResolution2) {
    MediaResolution2["MEDIA_RESOLUTION_UNSPECIFIED"] = "MEDIA_RESOLUTION_UNSPECIFIED";
    MediaResolution2["MEDIA_RESOLUTION_LOW"] = "MEDIA_RESOLUTION_LOW";
    MediaResolution2["MEDIA_RESOLUTION_MEDIUM"] = "MEDIA_RESOLUTION_MEDIUM";
    MediaResolution2["MEDIA_RESOLUTION_HIGH"] = "MEDIA_RESOLUTION_HIGH";
  })(MediaResolution || (MediaResolution = {}));
  var Modality;
  (function(Modality2) {
    Modality2["MODALITY_UNSPECIFIED"] = "MODALITY_UNSPECIFIED";
    Modality2["TEXT"] = "TEXT";
    Modality2["IMAGE"] = "IMAGE";
    Modality2["AUDIO"] = "AUDIO";
    Modality2["VIDEO"] = "VIDEO";
  })(Modality || (Modality = {}));
  var TuningMode;
  (function(TuningMode2) {
    TuningMode2["TUNING_MODE_UNSPECIFIED"] = "TUNING_MODE_UNSPECIFIED";
    TuningMode2["TUNING_MODE_FULL"] = "TUNING_MODE_FULL";
    TuningMode2["TUNING_MODE_PEFT_ADAPTER"] = "TUNING_MODE_PEFT_ADAPTER";
  })(TuningMode || (TuningMode = {}));
  var AdapterSize;
  (function(AdapterSize2) {
    AdapterSize2["ADAPTER_SIZE_UNSPECIFIED"] = "ADAPTER_SIZE_UNSPECIFIED";
    AdapterSize2["ADAPTER_SIZE_ONE"] = "ADAPTER_SIZE_ONE";
    AdapterSize2["ADAPTER_SIZE_TWO"] = "ADAPTER_SIZE_TWO";
    AdapterSize2["ADAPTER_SIZE_FOUR"] = "ADAPTER_SIZE_FOUR";
    AdapterSize2["ADAPTER_SIZE_EIGHT"] = "ADAPTER_SIZE_EIGHT";
    AdapterSize2["ADAPTER_SIZE_SIXTEEN"] = "ADAPTER_SIZE_SIXTEEN";
    AdapterSize2["ADAPTER_SIZE_THIRTY_TWO"] = "ADAPTER_SIZE_THIRTY_TWO";
  })(AdapterSize || (AdapterSize = {}));
  var JobState;
  (function(JobState2) {
    JobState2["JOB_STATE_UNSPECIFIED"] = "JOB_STATE_UNSPECIFIED";
    JobState2["JOB_STATE_QUEUED"] = "JOB_STATE_QUEUED";
    JobState2["JOB_STATE_PENDING"] = "JOB_STATE_PENDING";
    JobState2["JOB_STATE_RUNNING"] = "JOB_STATE_RUNNING";
    JobState2["JOB_STATE_SUCCEEDED"] = "JOB_STATE_SUCCEEDED";
    JobState2["JOB_STATE_FAILED"] = "JOB_STATE_FAILED";
    JobState2["JOB_STATE_CANCELLING"] = "JOB_STATE_CANCELLING";
    JobState2["JOB_STATE_CANCELLED"] = "JOB_STATE_CANCELLED";
    JobState2["JOB_STATE_PAUSED"] = "JOB_STATE_PAUSED";
    JobState2["JOB_STATE_EXPIRED"] = "JOB_STATE_EXPIRED";
    JobState2["JOB_STATE_UPDATING"] = "JOB_STATE_UPDATING";
    JobState2["JOB_STATE_PARTIALLY_SUCCEEDED"] = "JOB_STATE_PARTIALLY_SUCCEEDED";
  })(JobState || (JobState = {}));
  var TuningJobState;
  (function(TuningJobState2) {
    TuningJobState2["TUNING_JOB_STATE_UNSPECIFIED"] = "TUNING_JOB_STATE_UNSPECIFIED";
    TuningJobState2["TUNING_JOB_STATE_WAITING_FOR_QUOTA"] = "TUNING_JOB_STATE_WAITING_FOR_QUOTA";
    TuningJobState2["TUNING_JOB_STATE_PROCESSING_DATASET"] = "TUNING_JOB_STATE_PROCESSING_DATASET";
    TuningJobState2["TUNING_JOB_STATE_WAITING_FOR_CAPACITY"] = "TUNING_JOB_STATE_WAITING_FOR_CAPACITY";
    TuningJobState2["TUNING_JOB_STATE_TUNING"] = "TUNING_JOB_STATE_TUNING";
    TuningJobState2["TUNING_JOB_STATE_POST_PROCESSING"] = "TUNING_JOB_STATE_POST_PROCESSING";
  })(TuningJobState || (TuningJobState = {}));
  var AggregationMetric;
  (function(AggregationMetric2) {
    AggregationMetric2["AGGREGATION_METRIC_UNSPECIFIED"] = "AGGREGATION_METRIC_UNSPECIFIED";
    AggregationMetric2["AVERAGE"] = "AVERAGE";
    AggregationMetric2["MODE"] = "MODE";
    AggregationMetric2["STANDARD_DEVIATION"] = "STANDARD_DEVIATION";
    AggregationMetric2["VARIANCE"] = "VARIANCE";
    AggregationMetric2["MINIMUM"] = "MINIMUM";
    AggregationMetric2["MAXIMUM"] = "MAXIMUM";
    AggregationMetric2["MEDIAN"] = "MEDIAN";
    AggregationMetric2["PERCENTILE_P90"] = "PERCENTILE_P90";
    AggregationMetric2["PERCENTILE_P95"] = "PERCENTILE_P95";
    AggregationMetric2["PERCENTILE_P99"] = "PERCENTILE_P99";
  })(AggregationMetric || (AggregationMetric = {}));
  var PairwiseChoice;
  (function(PairwiseChoice2) {
    PairwiseChoice2["PAIRWISE_CHOICE_UNSPECIFIED"] = "PAIRWISE_CHOICE_UNSPECIFIED";
    PairwiseChoice2["BASELINE"] = "BASELINE";
    PairwiseChoice2["CANDIDATE"] = "CANDIDATE";
    PairwiseChoice2["TIE"] = "TIE";
  })(PairwiseChoice || (PairwiseChoice = {}));
  var TuningSpeed;
  (function(TuningSpeed2) {
    TuningSpeed2["TUNING_SPEED_UNSPECIFIED"] = "TUNING_SPEED_UNSPECIFIED";
    TuningSpeed2["REGULAR"] = "REGULAR";
    TuningSpeed2["FAST"] = "FAST";
  })(TuningSpeed || (TuningSpeed = {}));
  var TuningTask;
  (function(TuningTask2) {
    TuningTask2["TUNING_TASK_UNSPECIFIED"] = "TUNING_TASK_UNSPECIFIED";
    TuningTask2["TUNING_TASK_I2V"] = "TUNING_TASK_I2V";
    TuningTask2["TUNING_TASK_T2V"] = "TUNING_TASK_T2V";
    TuningTask2["TUNING_TASK_R2V"] = "TUNING_TASK_R2V";
  })(TuningTask || (TuningTask = {}));
  var VideoOrientation;
  (function(VideoOrientation2) {
    VideoOrientation2["VIDEO_ORIENTATION_UNSPECIFIED"] = "VIDEO_ORIENTATION_UNSPECIFIED";
    VideoOrientation2["LANDSCAPE"] = "LANDSCAPE";
    VideoOrientation2["PORTRAIT"] = "PORTRAIT";
  })(VideoOrientation || (VideoOrientation = {}));
  var DocumentState;
  (function(DocumentState2) {
    DocumentState2["STATE_UNSPECIFIED"] = "STATE_UNSPECIFIED";
    DocumentState2["STATE_PENDING"] = "STATE_PENDING";
    DocumentState2["STATE_ACTIVE"] = "STATE_ACTIVE";
    DocumentState2["STATE_FAILED"] = "STATE_FAILED";
  })(DocumentState || (DocumentState = {}));
  var ServiceTier;
  (function(ServiceTier2) {
    ServiceTier2["UNSPECIFIED"] = "unspecified";
    ServiceTier2["FLEX"] = "flex";
    ServiceTier2["STANDARD"] = "standard";
    ServiceTier2["PRIORITY"] = "priority";
  })(ServiceTier || (ServiceTier = {}));
  var PartMediaResolutionLevel;
  (function(PartMediaResolutionLevel2) {
    PartMediaResolutionLevel2["MEDIA_RESOLUTION_UNSPECIFIED"] = "MEDIA_RESOLUTION_UNSPECIFIED";
    PartMediaResolutionLevel2["MEDIA_RESOLUTION_LOW"] = "MEDIA_RESOLUTION_LOW";
    PartMediaResolutionLevel2["MEDIA_RESOLUTION_MEDIUM"] = "MEDIA_RESOLUTION_MEDIUM";
    PartMediaResolutionLevel2["MEDIA_RESOLUTION_HIGH"] = "MEDIA_RESOLUTION_HIGH";
    PartMediaResolutionLevel2["MEDIA_RESOLUTION_ULTRA_HIGH"] = "MEDIA_RESOLUTION_ULTRA_HIGH";
  })(PartMediaResolutionLevel || (PartMediaResolutionLevel = {}));
  var ToolType;
  (function(ToolType2) {
    ToolType2["TOOL_TYPE_UNSPECIFIED"] = "TOOL_TYPE_UNSPECIFIED";
    ToolType2["GOOGLE_SEARCH_WEB"] = "GOOGLE_SEARCH_WEB";
    ToolType2["GOOGLE_SEARCH_IMAGE"] = "GOOGLE_SEARCH_IMAGE";
    ToolType2["URL_CONTEXT"] = "URL_CONTEXT";
    ToolType2["GOOGLE_MAPS"] = "GOOGLE_MAPS";
    ToolType2["FILE_SEARCH"] = "FILE_SEARCH";
  })(ToolType || (ToolType = {}));
  var ResourceScope;
  (function(ResourceScope2) {
    ResourceScope2["COLLECTION"] = "COLLECTION";
  })(ResourceScope || (ResourceScope = {}));
  var FeatureSelectionPreference;
  (function(FeatureSelectionPreference2) {
    FeatureSelectionPreference2["FEATURE_SELECTION_PREFERENCE_UNSPECIFIED"] = "FEATURE_SELECTION_PREFERENCE_UNSPECIFIED";
    FeatureSelectionPreference2["PRIORITIZE_QUALITY"] = "PRIORITIZE_QUALITY";
    FeatureSelectionPreference2["BALANCED"] = "BALANCED";
    FeatureSelectionPreference2["PRIORITIZE_COST"] = "PRIORITIZE_COST";
  })(FeatureSelectionPreference || (FeatureSelectionPreference = {}));
  var EmbeddingApiType;
  (function(EmbeddingApiType2) {
    EmbeddingApiType2["PREDICT"] = "PREDICT";
    EmbeddingApiType2["EMBED_CONTENT"] = "EMBED_CONTENT";
  })(EmbeddingApiType || (EmbeddingApiType = {}));
  var SafetyFilterLevel;
  (function(SafetyFilterLevel2) {
    SafetyFilterLevel2["BLOCK_LOW_AND_ABOVE"] = "BLOCK_LOW_AND_ABOVE";
    SafetyFilterLevel2["BLOCK_MEDIUM_AND_ABOVE"] = "BLOCK_MEDIUM_AND_ABOVE";
    SafetyFilterLevel2["BLOCK_ONLY_HIGH"] = "BLOCK_ONLY_HIGH";
    SafetyFilterLevel2["BLOCK_NONE"] = "BLOCK_NONE";
  })(SafetyFilterLevel || (SafetyFilterLevel = {}));
  var ImagePromptLanguage;
  (function(ImagePromptLanguage2) {
    ImagePromptLanguage2["auto"] = "auto";
    ImagePromptLanguage2["en"] = "en";
    ImagePromptLanguage2["ja"] = "ja";
    ImagePromptLanguage2["ko"] = "ko";
    ImagePromptLanguage2["hi"] = "hi";
    ImagePromptLanguage2["zh"] = "zh";
    ImagePromptLanguage2["pt"] = "pt";
    ImagePromptLanguage2["es"] = "es";
  })(ImagePromptLanguage || (ImagePromptLanguage = {}));
  var MaskReferenceMode;
  (function(MaskReferenceMode2) {
    MaskReferenceMode2["MASK_MODE_DEFAULT"] = "MASK_MODE_DEFAULT";
    MaskReferenceMode2["MASK_MODE_USER_PROVIDED"] = "MASK_MODE_USER_PROVIDED";
    MaskReferenceMode2["MASK_MODE_BACKGROUND"] = "MASK_MODE_BACKGROUND";
    MaskReferenceMode2["MASK_MODE_FOREGROUND"] = "MASK_MODE_FOREGROUND";
    MaskReferenceMode2["MASK_MODE_SEMANTIC"] = "MASK_MODE_SEMANTIC";
  })(MaskReferenceMode || (MaskReferenceMode = {}));
  var ControlReferenceType;
  (function(ControlReferenceType2) {
    ControlReferenceType2["CONTROL_TYPE_DEFAULT"] = "CONTROL_TYPE_DEFAULT";
    ControlReferenceType2["CONTROL_TYPE_CANNY"] = "CONTROL_TYPE_CANNY";
    ControlReferenceType2["CONTROL_TYPE_SCRIBBLE"] = "CONTROL_TYPE_SCRIBBLE";
    ControlReferenceType2["CONTROL_TYPE_FACE_MESH"] = "CONTROL_TYPE_FACE_MESH";
  })(ControlReferenceType || (ControlReferenceType = {}));
  var SubjectReferenceType;
  (function(SubjectReferenceType2) {
    SubjectReferenceType2["SUBJECT_TYPE_DEFAULT"] = "SUBJECT_TYPE_DEFAULT";
    SubjectReferenceType2["SUBJECT_TYPE_PERSON"] = "SUBJECT_TYPE_PERSON";
    SubjectReferenceType2["SUBJECT_TYPE_ANIMAL"] = "SUBJECT_TYPE_ANIMAL";
    SubjectReferenceType2["SUBJECT_TYPE_PRODUCT"] = "SUBJECT_TYPE_PRODUCT";
  })(SubjectReferenceType || (SubjectReferenceType = {}));
  var EditMode;
  (function(EditMode2) {
    EditMode2["EDIT_MODE_DEFAULT"] = "EDIT_MODE_DEFAULT";
    EditMode2["EDIT_MODE_INPAINT_REMOVAL"] = "EDIT_MODE_INPAINT_REMOVAL";
    EditMode2["EDIT_MODE_INPAINT_INSERTION"] = "EDIT_MODE_INPAINT_INSERTION";
    EditMode2["EDIT_MODE_OUTPAINT"] = "EDIT_MODE_OUTPAINT";
    EditMode2["EDIT_MODE_CONTROLLED_EDITING"] = "EDIT_MODE_CONTROLLED_EDITING";
    EditMode2["EDIT_MODE_STYLE"] = "EDIT_MODE_STYLE";
    EditMode2["EDIT_MODE_BGSWAP"] = "EDIT_MODE_BGSWAP";
    EditMode2["EDIT_MODE_PRODUCT_IMAGE"] = "EDIT_MODE_PRODUCT_IMAGE";
  })(EditMode || (EditMode = {}));
  var SegmentMode;
  (function(SegmentMode2) {
    SegmentMode2["FOREGROUND"] = "FOREGROUND";
    SegmentMode2["BACKGROUND"] = "BACKGROUND";
    SegmentMode2["PROMPT"] = "PROMPT";
    SegmentMode2["SEMANTIC"] = "SEMANTIC";
    SegmentMode2["INTERACTIVE"] = "INTERACTIVE";
  })(SegmentMode || (SegmentMode = {}));
  var VideoGenerationReferenceType;
  (function(VideoGenerationReferenceType2) {
    VideoGenerationReferenceType2["ASSET"] = "ASSET";
    VideoGenerationReferenceType2["STYLE"] = "STYLE";
  })(VideoGenerationReferenceType || (VideoGenerationReferenceType = {}));
  var VideoGenerationMaskMode;
  (function(VideoGenerationMaskMode2) {
    VideoGenerationMaskMode2["INSERT"] = "INSERT";
    VideoGenerationMaskMode2["REMOVE"] = "REMOVE";
    VideoGenerationMaskMode2["REMOVE_STATIC"] = "REMOVE_STATIC";
    VideoGenerationMaskMode2["OUTPAINT"] = "OUTPAINT";
  })(VideoGenerationMaskMode || (VideoGenerationMaskMode = {}));
  var VideoCompressionQuality;
  (function(VideoCompressionQuality2) {
    VideoCompressionQuality2["OPTIMIZED"] = "OPTIMIZED";
    VideoCompressionQuality2["LOSSLESS"] = "LOSSLESS";
  })(VideoCompressionQuality || (VideoCompressionQuality = {}));
  var ImageResizeMode;
  (function(ImageResizeMode2) {
    ImageResizeMode2["CROP"] = "CROP";
    ImageResizeMode2["PAD"] = "PAD";
  })(ImageResizeMode || (ImageResizeMode = {}));
  var ResponseParseType;
  (function(ResponseParseType2) {
    ResponseParseType2["RESPONSE_PARSE_TYPE_UNSPECIFIED"] = "RESPONSE_PARSE_TYPE_UNSPECIFIED";
    ResponseParseType2["IDENTITY"] = "IDENTITY";
    ResponseParseType2["REGEX_EXTRACT"] = "REGEX_EXTRACT";
  })(ResponseParseType || (ResponseParseType = {}));
  var MatchOperation;
  (function(MatchOperation2) {
    MatchOperation2["MATCH_OPERATION_UNSPECIFIED"] = "MATCH_OPERATION_UNSPECIFIED";
    MatchOperation2["REGEX_CONTAINS"] = "REGEX_CONTAINS";
    MatchOperation2["PARTIAL_MATCH"] = "PARTIAL_MATCH";
    MatchOperation2["EXACT_MATCH"] = "EXACT_MATCH";
  })(MatchOperation || (MatchOperation = {}));
  var ReinforcementTuningThinkingLevel;
  (function(ReinforcementTuningThinkingLevel2) {
    ReinforcementTuningThinkingLevel2["REINFORCEMENT_TUNING_THINKING_LEVEL_UNSPECIFIED"] = "REINFORCEMENT_TUNING_THINKING_LEVEL_UNSPECIFIED";
    ReinforcementTuningThinkingLevel2["MINIMAL"] = "MINIMAL";
    ReinforcementTuningThinkingLevel2["HIGH"] = "HIGH";
  })(ReinforcementTuningThinkingLevel || (ReinforcementTuningThinkingLevel = {}));
  var TuningMethod;
  (function(TuningMethod2) {
    TuningMethod2["SUPERVISED_FINE_TUNING"] = "SUPERVISED_FINE_TUNING";
    TuningMethod2["PREFERENCE_TUNING"] = "PREFERENCE_TUNING";
    TuningMethod2["DISTILLATION"] = "DISTILLATION";
    TuningMethod2["REINFORCEMENT_TUNING"] = "REINFORCEMENT_TUNING";
  })(TuningMethod || (TuningMethod = {}));
  var FileState;
  (function(FileState2) {
    FileState2["STATE_UNSPECIFIED"] = "STATE_UNSPECIFIED";
    FileState2["PROCESSING"] = "PROCESSING";
    FileState2["ACTIVE"] = "ACTIVE";
    FileState2["FAILED"] = "FAILED";
  })(FileState || (FileState = {}));
  var FileSource;
  (function(FileSource2) {
    FileSource2["SOURCE_UNSPECIFIED"] = "SOURCE_UNSPECIFIED";
    FileSource2["UPLOADED"] = "UPLOADED";
    FileSource2["GENERATED"] = "GENERATED";
    FileSource2["REGISTERED"] = "REGISTERED";
  })(FileSource || (FileSource = {}));
  var TurnCompleteReason;
  (function(TurnCompleteReason2) {
    TurnCompleteReason2["TURN_COMPLETE_REASON_UNSPECIFIED"] = "TURN_COMPLETE_REASON_UNSPECIFIED";
    TurnCompleteReason2["MALFORMED_FUNCTION_CALL"] = "MALFORMED_FUNCTION_CALL";
    TurnCompleteReason2["RESPONSE_REJECTED"] = "RESPONSE_REJECTED";
    TurnCompleteReason2["NEED_MORE_INPUT"] = "NEED_MORE_INPUT";
    TurnCompleteReason2["PROHIBITED_INPUT_CONTENT"] = "PROHIBITED_INPUT_CONTENT";
    TurnCompleteReason2["IMAGE_PROHIBITED_INPUT_CONTENT"] = "IMAGE_PROHIBITED_INPUT_CONTENT";
    TurnCompleteReason2["INPUT_TEXT_CONTAIN_PROMINENT_PERSON_PROHIBITED"] = "INPUT_TEXT_CONTAIN_PROMINENT_PERSON_PROHIBITED";
    TurnCompleteReason2["INPUT_IMAGE_CELEBRITY"] = "INPUT_IMAGE_CELEBRITY";
    TurnCompleteReason2["INPUT_IMAGE_PHOTO_REALISTIC_CHILD_PROHIBITED"] = "INPUT_IMAGE_PHOTO_REALISTIC_CHILD_PROHIBITED";
    TurnCompleteReason2["INPUT_TEXT_NCII_PROHIBITED"] = "INPUT_TEXT_NCII_PROHIBITED";
    TurnCompleteReason2["INPUT_OTHER"] = "INPUT_OTHER";
    TurnCompleteReason2["INPUT_IP_PROHIBITED"] = "INPUT_IP_PROHIBITED";
    TurnCompleteReason2["BLOCKLIST"] = "BLOCKLIST";
    TurnCompleteReason2["UNSAFE_PROMPT_FOR_IMAGE_GENERATION"] = "UNSAFE_PROMPT_FOR_IMAGE_GENERATION";
    TurnCompleteReason2["GENERATED_IMAGE_SAFETY"] = "GENERATED_IMAGE_SAFETY";
    TurnCompleteReason2["GENERATED_CONTENT_SAFETY"] = "GENERATED_CONTENT_SAFETY";
    TurnCompleteReason2["GENERATED_AUDIO_SAFETY"] = "GENERATED_AUDIO_SAFETY";
    TurnCompleteReason2["GENERATED_VIDEO_SAFETY"] = "GENERATED_VIDEO_SAFETY";
    TurnCompleteReason2["GENERATED_CONTENT_PROHIBITED"] = "GENERATED_CONTENT_PROHIBITED";
    TurnCompleteReason2["GENERATED_CONTENT_BLOCKLIST"] = "GENERATED_CONTENT_BLOCKLIST";
    TurnCompleteReason2["GENERATED_IMAGE_PROHIBITED"] = "GENERATED_IMAGE_PROHIBITED";
    TurnCompleteReason2["GENERATED_IMAGE_CELEBRITY"] = "GENERATED_IMAGE_CELEBRITY";
    TurnCompleteReason2["GENERATED_IMAGE_PROMINENT_PEOPLE_DETECTED_BY_REWRITER"] = "GENERATED_IMAGE_PROMINENT_PEOPLE_DETECTED_BY_REWRITER";
    TurnCompleteReason2["GENERATED_IMAGE_IDENTIFIABLE_PEOPLE"] = "GENERATED_IMAGE_IDENTIFIABLE_PEOPLE";
    TurnCompleteReason2["GENERATED_IMAGE_MINORS"] = "GENERATED_IMAGE_MINORS";
    TurnCompleteReason2["OUTPUT_IMAGE_IP_PROHIBITED"] = "OUTPUT_IMAGE_IP_PROHIBITED";
    TurnCompleteReason2["GENERATED_OTHER"] = "GENERATED_OTHER";
    TurnCompleteReason2["MAX_REGENERATION_REACHED"] = "MAX_REGENERATION_REACHED";
  })(TurnCompleteReason || (TurnCompleteReason = {}));
  var VadSignalType;
  (function(VadSignalType2) {
    VadSignalType2["VAD_SIGNAL_TYPE_UNSPECIFIED"] = "VAD_SIGNAL_TYPE_UNSPECIFIED";
    VadSignalType2["VAD_SIGNAL_TYPE_SOS"] = "VAD_SIGNAL_TYPE_SOS";
    VadSignalType2["VAD_SIGNAL_TYPE_EOS"] = "VAD_SIGNAL_TYPE_EOS";
  })(VadSignalType || (VadSignalType = {}));
  var VoiceActivityType;
  (function(VoiceActivityType2) {
    VoiceActivityType2["TYPE_UNSPECIFIED"] = "TYPE_UNSPECIFIED";
    VoiceActivityType2["ACTIVITY_START"] = "ACTIVITY_START";
    VoiceActivityType2["ACTIVITY_END"] = "ACTIVITY_END";
  })(VoiceActivityType || (VoiceActivityType = {}));
  var StartSensitivity;
  (function(StartSensitivity2) {
    StartSensitivity2["START_SENSITIVITY_UNSPECIFIED"] = "START_SENSITIVITY_UNSPECIFIED";
    StartSensitivity2["START_SENSITIVITY_HIGH"] = "START_SENSITIVITY_HIGH";
    StartSensitivity2["START_SENSITIVITY_LOW"] = "START_SENSITIVITY_LOW";
  })(StartSensitivity || (StartSensitivity = {}));
  var EndSensitivity;
  (function(EndSensitivity2) {
    EndSensitivity2["END_SENSITIVITY_UNSPECIFIED"] = "END_SENSITIVITY_UNSPECIFIED";
    EndSensitivity2["END_SENSITIVITY_HIGH"] = "END_SENSITIVITY_HIGH";
    EndSensitivity2["END_SENSITIVITY_LOW"] = "END_SENSITIVITY_LOW";
  })(EndSensitivity || (EndSensitivity = {}));
  var ActivityHandling;
  (function(ActivityHandling2) {
    ActivityHandling2["ACTIVITY_HANDLING_UNSPECIFIED"] = "ACTIVITY_HANDLING_UNSPECIFIED";
    ActivityHandling2["START_OF_ACTIVITY_INTERRUPTS"] = "START_OF_ACTIVITY_INTERRUPTS";
    ActivityHandling2["NO_INTERRUPTION"] = "NO_INTERRUPTION";
  })(ActivityHandling || (ActivityHandling = {}));
  var TurnCoverage;
  (function(TurnCoverage2) {
    TurnCoverage2["TURN_COVERAGE_UNSPECIFIED"] = "TURN_COVERAGE_UNSPECIFIED";
    TurnCoverage2["TURN_INCLUDES_ONLY_ACTIVITY"] = "TURN_INCLUDES_ONLY_ACTIVITY";
    TurnCoverage2["TURN_INCLUDES_ALL_INPUT"] = "TURN_INCLUDES_ALL_INPUT";
    TurnCoverage2["TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO"] = "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO";
  })(TurnCoverage || (TurnCoverage = {}));
  var Scale;
  (function(Scale2) {
    Scale2["SCALE_UNSPECIFIED"] = "SCALE_UNSPECIFIED";
    Scale2["C_MAJOR_A_MINOR"] = "C_MAJOR_A_MINOR";
    Scale2["D_FLAT_MAJOR_B_FLAT_MINOR"] = "D_FLAT_MAJOR_B_FLAT_MINOR";
    Scale2["D_MAJOR_B_MINOR"] = "D_MAJOR_B_MINOR";
    Scale2["E_FLAT_MAJOR_C_MINOR"] = "E_FLAT_MAJOR_C_MINOR";
    Scale2["E_MAJOR_D_FLAT_MINOR"] = "E_MAJOR_D_FLAT_MINOR";
    Scale2["F_MAJOR_D_MINOR"] = "F_MAJOR_D_MINOR";
    Scale2["G_FLAT_MAJOR_E_FLAT_MINOR"] = "G_FLAT_MAJOR_E_FLAT_MINOR";
    Scale2["G_MAJOR_E_MINOR"] = "G_MAJOR_E_MINOR";
    Scale2["A_FLAT_MAJOR_F_MINOR"] = "A_FLAT_MAJOR_F_MINOR";
    Scale2["A_MAJOR_G_FLAT_MINOR"] = "A_MAJOR_G_FLAT_MINOR";
    Scale2["B_FLAT_MAJOR_G_MINOR"] = "B_FLAT_MAJOR_G_MINOR";
    Scale2["B_MAJOR_A_FLAT_MINOR"] = "B_MAJOR_A_FLAT_MINOR";
  })(Scale || (Scale = {}));
  var MusicGenerationMode;
  (function(MusicGenerationMode2) {
    MusicGenerationMode2["MUSIC_GENERATION_MODE_UNSPECIFIED"] = "MUSIC_GENERATION_MODE_UNSPECIFIED";
    MusicGenerationMode2["QUALITY"] = "QUALITY";
    MusicGenerationMode2["DIVERSITY"] = "DIVERSITY";
    MusicGenerationMode2["VOCALIZATION"] = "VOCALIZATION";
  })(MusicGenerationMode || (MusicGenerationMode = {}));
  var LiveMusicPlaybackControl;
  (function(LiveMusicPlaybackControl2) {
    LiveMusicPlaybackControl2["PLAYBACK_CONTROL_UNSPECIFIED"] = "PLAYBACK_CONTROL_UNSPECIFIED";
    LiveMusicPlaybackControl2["PLAY"] = "PLAY";
    LiveMusicPlaybackControl2["PAUSE"] = "PAUSE";
    LiveMusicPlaybackControl2["STOP"] = "STOP";
    LiveMusicPlaybackControl2["RESET_CONTEXT"] = "RESET_CONTEXT";
  })(LiveMusicPlaybackControl || (LiveMusicPlaybackControl = {}));
  var HttpResponse = class {
    constructor(response) {
      const headers = {};
      for (const pair of response.headers.entries()) {
        headers[pair[0]] = pair[1];
      }
      this.headers = headers;
      this.responseInternal = response;
    }
    json() {
      return this.responseInternal.json();
    }
  };
  var GenerateContentResponse = class {
    /**
     * Returns the concatenation of all text parts from the first candidate in the response.
     *
     * @remarks
     * If there are multiple candidates in the response, the text from the first
     * one will be returned.
     * If there are non-text parts in the response, the concatenation of all text
     * parts will be returned, and a warning will be logged.
     * If there are thought parts in the response, the concatenation of all text
     * parts excluding the thought parts will be returned.
     *
     * @example
     * ```ts
     * const response = await ai.models.generateContent({
     *   model: 'gemini-2.0-flash',
     *   contents:
     *     'Why is the sky blue?',
     * });
     *
     * console.debug(response.text);
     * ```
     */
    get text() {
      var _a2, _b, _c, _d, _e, _f, _g, _h;
      if (((_d = (_c = (_b = (_a2 = this.candidates) === null || _a2 === void 0 ? void 0 : _a2[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d.length) === 0) {
        return void 0;
      }
      if (this.candidates && this.candidates.length > 1) {
        console.warn("there are multiple candidates in the response, returning text from the first one.");
      }
      let text = "";
      let anyTextPartText = false;
      const nonTextParts = [];
      for (const part of (_h = (_g = (_f = (_e = this.candidates) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.parts) !== null && _h !== void 0 ? _h : []) {
        for (const [fieldName, fieldValue] of Object.entries(part)) {
          if (fieldName !== "text" && fieldName !== "thought" && fieldName !== "thoughtSignature" && (fieldValue !== null || fieldValue !== void 0)) {
            nonTextParts.push(fieldName);
          }
        }
        if (typeof part.text === "string") {
          if (typeof part.thought === "boolean" && part.thought) {
            continue;
          }
          anyTextPartText = true;
          text += part.text;
        }
      }
      if (nonTextParts.length > 0) {
        console.warn(`there are non-text parts ${nonTextParts} in the response, returning concatenation of all text parts. Please refer to the non text parts for a full response from model.`);
      }
      return anyTextPartText ? text : void 0;
    }
    /**
     * Returns the concatenation of all inline data parts from the first candidate
     * in the response.
     *
     * @remarks
     * If there are multiple candidates in the response, the inline data from the
     * first one will be returned. If there are non-inline data parts in the
     * response, the concatenation of all inline data parts will be returned, and
     * a warning will be logged.
     */
    get data() {
      var _a2, _b, _c, _d, _e, _f, _g, _h;
      if (((_d = (_c = (_b = (_a2 = this.candidates) === null || _a2 === void 0 ? void 0 : _a2[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d.length) === 0) {
        return void 0;
      }
      if (this.candidates && this.candidates.length > 1) {
        console.warn("there are multiple candidates in the response, returning data from the first one.");
      }
      let data = "";
      const nonDataParts = [];
      for (const part of (_h = (_g = (_f = (_e = this.candidates) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.parts) !== null && _h !== void 0 ? _h : []) {
        for (const [fieldName, fieldValue] of Object.entries(part)) {
          if (fieldName !== "inlineData" && (fieldValue !== null || fieldValue !== void 0)) {
            nonDataParts.push(fieldName);
          }
        }
        if (part.inlineData && typeof part.inlineData.data === "string") {
          data += atob(part.inlineData.data);
        }
      }
      if (nonDataParts.length > 0) {
        console.warn(`there are non-data parts ${nonDataParts} in the response, returning concatenation of all data parts. Please refer to the non data parts for a full response from model.`);
      }
      return data.length > 0 ? btoa(data) : void 0;
    }
    /**
     * Returns the function calls from the first candidate in the response.
     *
     * @remarks
     * If there are multiple candidates in the response, the function calls from
     * the first one will be returned.
     * If there are no function calls in the response, undefined will be returned.
     *
     * @example
     * ```ts
     * const controlLightFunctionDeclaration: FunctionDeclaration = {
     *   name: 'controlLight',
     *   parameters: {
     *   type: Type.OBJECT,
     *   description: 'Set the brightness and color temperature of a room light.',
     *   properties: {
     *     brightness: {
     *       type: Type.NUMBER,
     *       description:
     *         'Light level from 0 to 100. Zero is off and 100 is full brightness.',
     *     },
     *     colorTemperature: {
     *       type: Type.STRING,
     *       description:
     *         'Color temperature of the light fixture which can be `daylight`, `cool` or `warm`.',
     *     },
     *   },
     *   required: ['brightness', 'colorTemperature'],
     *  };
     *  const response = await ai.models.generateContent({
     *     model: 'gemini-2.0-flash',
     *     contents: 'Dim the lights so the room feels cozy and warm.',
     *     config: {
     *       tools: [{functionDeclarations: [controlLightFunctionDeclaration]}],
     *       toolConfig: {
     *         functionCallingConfig: {
     *           mode: FunctionCallingConfigMode.ANY,
     *           allowedFunctionNames: ['controlLight'],
     *         },
     *       },
     *     },
     *   });
     *  console.debug(JSON.stringify(response.functionCalls));
     * ```
     */
    get functionCalls() {
      var _a2, _b, _c, _d, _e, _f, _g, _h;
      if (((_d = (_c = (_b = (_a2 = this.candidates) === null || _a2 === void 0 ? void 0 : _a2[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d.length) === 0) {
        return void 0;
      }
      if (this.candidates && this.candidates.length > 1) {
        console.warn("there are multiple candidates in the response, returning function calls from the first one.");
      }
      const functionCalls = (_h = (_g = (_f = (_e = this.candidates) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.parts) === null || _h === void 0 ? void 0 : _h.filter((part) => part.functionCall).map((part) => part.functionCall).filter((functionCall) => functionCall !== void 0);
      if ((functionCalls === null || functionCalls === void 0 ? void 0 : functionCalls.length) === 0) {
        return void 0;
      }
      return functionCalls;
    }
    /**
     * Returns the first executable code from the first candidate in the response.
     *
     * @remarks
     * If there are multiple candidates in the response, the executable code from
     * the first one will be returned.
     * If there are no executable code in the response, undefined will be
     * returned.
     *
     * @example
     * ```ts
     * const response = await ai.models.generateContent({
     *   model: 'gemini-2.0-flash',
     *   contents:
     *     'What is the sum of the first 50 prime numbers? Generate and run code for the calculation, and make sure you get all 50.'
     *   config: {
     *     tools: [{codeExecution: {}}],
     *   },
     * });
     *
     * console.debug(response.executableCode);
     * ```
     */
    get executableCode() {
      var _a2, _b, _c, _d, _e, _f, _g, _h, _j;
      if (((_d = (_c = (_b = (_a2 = this.candidates) === null || _a2 === void 0 ? void 0 : _a2[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d.length) === 0) {
        return void 0;
      }
      if (this.candidates && this.candidates.length > 1) {
        console.warn("there are multiple candidates in the response, returning executable code from the first one.");
      }
      const executableCode = (_h = (_g = (_f = (_e = this.candidates) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.parts) === null || _h === void 0 ? void 0 : _h.filter((part) => part.executableCode).map((part) => part.executableCode).filter((executableCode2) => executableCode2 !== void 0);
      if ((executableCode === null || executableCode === void 0 ? void 0 : executableCode.length) === 0) {
        return void 0;
      }
      return (_j = executableCode === null || executableCode === void 0 ? void 0 : executableCode[0]) === null || _j === void 0 ? void 0 : _j.code;
    }
    /**
     * Returns the first code execution result from the first candidate in the response.
     *
     * @remarks
     * If there are multiple candidates in the response, the code execution result from
     * the first one will be returned.
     * If there are no code execution result in the response, undefined will be returned.
     *
     * @example
     * ```ts
     * const response = await ai.models.generateContent({
     *   model: 'gemini-2.0-flash',
     *   contents:
     *     'What is the sum of the first 50 prime numbers? Generate and run code for the calculation, and make sure you get all 50.'
     *   config: {
     *     tools: [{codeExecution: {}}],
     *   },
     * });
     *
     * console.debug(response.codeExecutionResult);
     * ```
     */
    get codeExecutionResult() {
      var _a2, _b, _c, _d, _e, _f, _g, _h, _j;
      if (((_d = (_c = (_b = (_a2 = this.candidates) === null || _a2 === void 0 ? void 0 : _a2[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d.length) === 0) {
        return void 0;
      }
      if (this.candidates && this.candidates.length > 1) {
        console.warn("there are multiple candidates in the response, returning code execution result from the first one.");
      }
      const codeExecutionResult = (_h = (_g = (_f = (_e = this.candidates) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.parts) === null || _h === void 0 ? void 0 : _h.filter((part) => part.codeExecutionResult).map((part) => part.codeExecutionResult).filter((codeExecutionResult2) => codeExecutionResult2 !== void 0);
      if ((codeExecutionResult === null || codeExecutionResult === void 0 ? void 0 : codeExecutionResult.length) === 0) {
        return void 0;
      }
      return (_j = codeExecutionResult === null || codeExecutionResult === void 0 ? void 0 : codeExecutionResult[0]) === null || _j === void 0 ? void 0 : _j.output;
    }
  };
  var EmbedContentResponse = class {
  };
  var GenerateImagesResponse = class {
  };
  var EditImageResponse = class {
  };
  var UpscaleImageResponse = class {
  };
  var RecontextImageResponse = class {
  };
  var SegmentImageResponse = class {
  };
  var ListModelsResponse = class {
  };
  var DeleteModelResponse = class {
  };
  var CountTokensResponse = class {
  };
  var ComputeTokensResponse = class {
  };
  var GenerateVideosOperation = class _GenerateVideosOperation {
    /**
     * Instantiates an Operation of the same type as the one being called with the fields set from the API response.
     */
    _fromAPIResponse({ apiResponse, _isVertexAI }) {
      const operation = new _GenerateVideosOperation();
      let response;
      const op = apiResponse;
      if (_isVertexAI) {
        response = generateVideosOperationFromVertex$1(op);
      } else {
        response = generateVideosOperationFromMldev$1(op);
      }
      Object.assign(operation, response);
      return operation;
    }
  };
  var ListTuningJobsResponse = class {
  };
  var CancelTuningJobResponse = class {
  };
  var ValidateRewardResponse = class {
  };
  var DeleteCachedContentResponse = class {
  };
  var ListCachedContentsResponse = class {
  };
  var ListDocumentsResponse = class {
  };
  var ListFileSearchStoresResponse = class {
  };
  var UploadToFileSearchStoreResumableResponse = class {
  };
  var ImportFileOperation = class _ImportFileOperation {
    /**
     * Instantiates an Operation of the same type as the one being called with the fields set from the API response.
     */
    _fromAPIResponse({ apiResponse, _isVertexAI }) {
      const operation = new _ImportFileOperation();
      const op = apiResponse;
      const response = importFileOperationFromMldev$1(op);
      Object.assign(operation, response);
      return operation;
    }
  };
  var ListFilesResponse = class {
  };
  var CreateFileResponse = class {
  };
  var DeleteFileResponse = class {
  };
  var RegisterFilesResponse = class {
  };
  var ListBatchJobsResponse = class {
  };
  var LiveServerMessage = class {
    /**
     * Returns the concatenation of all text parts from the server content if present.
     *
     * @remarks
     * If there are non-text parts in the response, the concatenation of all text
     * parts will be returned, and a warning will be logged.
     */
    get text() {
      var _a2, _b, _c;
      let text = "";
      let anyTextPartFound = false;
      const nonTextParts = [];
      for (const part of (_c = (_b = (_a2 = this.serverContent) === null || _a2 === void 0 ? void 0 : _a2.modelTurn) === null || _b === void 0 ? void 0 : _b.parts) !== null && _c !== void 0 ? _c : []) {
        for (const [fieldName, fieldValue] of Object.entries(part)) {
          if (fieldName !== "text" && fieldName !== "thought" && fieldValue !== null) {
            nonTextParts.push(fieldName);
          }
        }
        if (typeof part.text === "string") {
          if (typeof part.thought === "boolean" && part.thought) {
            continue;
          }
          anyTextPartFound = true;
          text += part.text;
        }
      }
      if (nonTextParts.length > 0) {
        console.warn(`there are non-text parts ${nonTextParts} in the response, returning concatenation of all text parts. Please refer to the non text parts for a full response from model.`);
      }
      return anyTextPartFound ? text : void 0;
    }
    /**
     * Returns the concatenation of all inline data parts from the server content if present.
     *
     * @remarks
     * If there are non-inline data parts in the
     * response, the concatenation of all inline data parts will be returned, and
     * a warning will be logged.
     */
    get data() {
      var _a2, _b, _c;
      let data = "";
      const nonDataParts = [];
      for (const part of (_c = (_b = (_a2 = this.serverContent) === null || _a2 === void 0 ? void 0 : _a2.modelTurn) === null || _b === void 0 ? void 0 : _b.parts) !== null && _c !== void 0 ? _c : []) {
        for (const [fieldName, fieldValue] of Object.entries(part)) {
          if (fieldName !== "inlineData" && fieldValue !== null) {
            nonDataParts.push(fieldName);
          }
        }
        if (part.inlineData && typeof part.inlineData.data === "string") {
          data += atob(part.inlineData.data);
        }
      }
      if (nonDataParts.length > 0) {
        console.warn(`there are non-data parts ${nonDataParts} in the response, returning concatenation of all data parts. Please refer to the non data parts for a full response from model.`);
      }
      return data.length > 0 ? btoa(data) : void 0;
    }
  };
  var LiveMusicServerMessage = class {
    /**
     * Returns the first audio chunk from the server content, if present.
     *
     * @remarks
     * If there are no audio chunks in the response, undefined will be returned.
     */
    get audioChunk() {
      if (this.serverContent && this.serverContent.audioChunks && this.serverContent.audioChunks.length > 0) {
        return this.serverContent.audioChunks[0];
      }
      return void 0;
    }
  };
  var UploadToFileSearchStoreOperation = class _UploadToFileSearchStoreOperation {
    /**
     * Instantiates an Operation of the same type as the one being called with the fields set from the API response.
     */
    _fromAPIResponse({ apiResponse, _isVertexAI }) {
      const operation = new _UploadToFileSearchStoreOperation();
      const op = apiResponse;
      const response = uploadToFileSearchStoreOperationFromMldev(op);
      Object.assign(operation, response);
      return operation;
    }
  };
  function tModel(apiClient, model) {
    if (!model || typeof model !== "string") {
      throw new Error("model is required and must be a string");
    }
    if (model.includes("..") || model.includes("?") || model.includes("&")) {
      throw new Error("invalid model parameter");
    }
    if (apiClient.isVertexAI()) {
      if (model.startsWith("publishers/") || model.startsWith("projects/") || model.startsWith("models/")) {
        return model;
      } else if (model.indexOf("/") >= 0) {
        const parts = model.split("/", 2);
        return `publishers/${parts[0]}/models/${parts[1]}`;
      } else {
        return `publishers/google/models/${model}`;
      }
    } else {
      if (model.startsWith("models/") || model.startsWith("tunedModels/")) {
        return model;
      } else {
        return `models/${model}`;
      }
    }
  }
  function tCachesModel(apiClient, model) {
    const transformedModel = tModel(apiClient, model);
    if (!transformedModel) {
      return "";
    }
    if (transformedModel.startsWith("publishers/") && apiClient.isVertexAI()) {
      return `projects/${apiClient.getProject()}/locations/${apiClient.getLocation()}/${transformedModel}`;
    } else if (transformedModel.startsWith("models/") && apiClient.isVertexAI()) {
      return `projects/${apiClient.getProject()}/locations/${apiClient.getLocation()}/publishers/google/${transformedModel}`;
    } else {
      return transformedModel;
    }
  }
  function tBlobs(blobs) {
    if (Array.isArray(blobs)) {
      return blobs.map((blob) => tBlob(blob));
    } else {
      return [tBlob(blobs)];
    }
  }
  function tBlob(blob) {
    if (typeof blob === "object" && blob !== null) {
      return blob;
    }
    throw new Error(`Could not parse input as Blob. Unsupported blob type: ${typeof blob}`);
  }
  function tImageBlob(blob) {
    const transformedBlob = tBlob(blob);
    if (transformedBlob.mimeType && transformedBlob.mimeType.startsWith("image/")) {
      return transformedBlob;
    }
    throw new Error(`Unsupported mime type: ${transformedBlob.mimeType}`);
  }
  function tAudioBlob(blob) {
    const transformedBlob = tBlob(blob);
    if (transformedBlob.mimeType && transformedBlob.mimeType.startsWith("audio/")) {
      return transformedBlob;
    }
    throw new Error(`Unsupported mime type: ${transformedBlob.mimeType}`);
  }
  function tPart(origin) {
    if (origin === null || origin === void 0) {
      throw new Error("PartUnion is required");
    }
    if (typeof origin === "object") {
      return origin;
    }
    if (typeof origin === "string") {
      return { text: origin };
    }
    throw new Error(`Unsupported part type: ${typeof origin}`);
  }
  function tParts(origin) {
    if (origin === null || origin === void 0 || Array.isArray(origin) && origin.length === 0) {
      throw new Error("PartListUnion is required");
    }
    if (Array.isArray(origin)) {
      return origin.map((item) => tPart(item));
    }
    return [tPart(origin)];
  }
  function _isContent(origin) {
    return origin !== null && origin !== void 0 && typeof origin === "object" && "parts" in origin && Array.isArray(origin.parts);
  }
  function _isFunctionCallPart(origin) {
    return origin !== null && origin !== void 0 && typeof origin === "object" && "functionCall" in origin;
  }
  function _isFunctionResponsePart(origin) {
    return origin !== null && origin !== void 0 && typeof origin === "object" && "functionResponse" in origin;
  }
  function tContent(origin) {
    if (origin === null || origin === void 0) {
      throw new Error("ContentUnion is required");
    }
    if (_isContent(origin)) {
      return origin;
    }
    return {
      role: "user",
      parts: tParts(origin)
    };
  }
  function tContentsForEmbed(apiClient, origin) {
    if (!origin) {
      return [];
    }
    if (apiClient.isVertexAI() && Array.isArray(origin)) {
      return origin.flatMap((item) => {
        const content = tContent(item);
        if (content.parts && content.parts.length > 0 && content.parts[0].text !== void 0) {
          return [content.parts[0].text];
        }
        return [];
      });
    } else if (apiClient.isVertexAI()) {
      const content = tContent(origin);
      if (content.parts && content.parts.length > 0 && content.parts[0].text !== void 0) {
        return [content.parts[0].text];
      }
      return [];
    }
    if (Array.isArray(origin)) {
      return origin.map((item) => tContent(item));
    }
    return [tContent(origin)];
  }
  function tContents(origin) {
    if (origin === null || origin === void 0 || Array.isArray(origin) && origin.length === 0) {
      throw new Error("contents are required");
    }
    if (!Array.isArray(origin)) {
      if (_isFunctionCallPart(origin) || _isFunctionResponsePart(origin)) {
        throw new Error("To specify functionCall or functionResponse parts, please wrap them in a Content object, specifying the role for them");
      }
      return [tContent(origin)];
    }
    const result = [];
    const accumulatedParts = [];
    const isContentArray = _isContent(origin[0]);
    for (const item of origin) {
      const isContent = _isContent(item);
      if (isContent != isContentArray) {
        throw new Error("Mixing Content and Parts is not supported, please group the parts into a the appropriate Content objects and specify the roles for them");
      }
      if (isContent) {
        result.push(item);
      } else if (_isFunctionCallPart(item) || _isFunctionResponsePart(item)) {
        throw new Error("To specify functionCall or functionResponse parts, please wrap them, and any other parts, in Content objects as appropriate, specifying the role for them");
      } else {
        accumulatedParts.push(item);
      }
    }
    if (!isContentArray) {
      result.push({ role: "user", parts: tParts(accumulatedParts) });
    }
    return result;
  }
  function flattenTypeArrayToAnyOf(typeList, resultingSchema) {
    if (typeList.includes("null")) {
      resultingSchema["nullable"] = true;
    }
    const listWithoutNull = typeList.filter((type) => type !== "null");
    if (listWithoutNull.length === 1) {
      resultingSchema["type"] = Object.values(Type).includes(listWithoutNull[0].toUpperCase()) ? listWithoutNull[0].toUpperCase() : Type.TYPE_UNSPECIFIED;
    } else {
      resultingSchema["anyOf"] = [];
      for (const i of listWithoutNull) {
        resultingSchema["anyOf"].push({
          "type": Object.values(Type).includes(i.toUpperCase()) ? i.toUpperCase() : Type.TYPE_UNSPECIFIED
        });
      }
    }
  }
  function processJsonSchema(_jsonSchema) {
    const genAISchema = {};
    const schemaFieldNames = ["items"];
    const listSchemaFieldNames = ["anyOf"];
    const dictSchemaFieldNames = ["properties"];
    if (_jsonSchema["type"] && _jsonSchema["anyOf"]) {
      throw new Error("type and anyOf cannot be both populated.");
    }
    const incomingAnyOf = _jsonSchema["anyOf"];
    if (incomingAnyOf != null && incomingAnyOf.length == 2) {
      if (incomingAnyOf[0]["type"] === "null") {
        genAISchema["nullable"] = true;
        _jsonSchema = incomingAnyOf[1];
      } else if (incomingAnyOf[1]["type"] === "null") {
        genAISchema["nullable"] = true;
        _jsonSchema = incomingAnyOf[0];
      }
    }
    if (_jsonSchema["type"] instanceof Array) {
      flattenTypeArrayToAnyOf(_jsonSchema["type"], genAISchema);
    }
    for (const [fieldName, fieldValue] of Object.entries(_jsonSchema)) {
      if (fieldValue == null) {
        continue;
      }
      if (fieldName == "type") {
        if (fieldValue === "null") {
          throw new Error("type: null can not be the only possible type for the field.");
        }
        if (fieldValue instanceof Array) {
          continue;
        }
        genAISchema["type"] = Object.values(Type).includes(fieldValue.toUpperCase()) ? fieldValue.toUpperCase() : Type.TYPE_UNSPECIFIED;
      } else if (schemaFieldNames.includes(fieldName)) {
        genAISchema[fieldName] = processJsonSchema(fieldValue);
      } else if (listSchemaFieldNames.includes(fieldName)) {
        const listSchemaFieldValue = [];
        for (const item of fieldValue) {
          if (item["type"] == "null") {
            genAISchema["nullable"] = true;
            continue;
          }
          listSchemaFieldValue.push(processJsonSchema(item));
        }
        genAISchema[fieldName] = listSchemaFieldValue;
      } else if (dictSchemaFieldNames.includes(fieldName)) {
        const dictSchemaFieldValue = {};
        for (const [key, value] of Object.entries(fieldValue)) {
          dictSchemaFieldValue[key] = processJsonSchema(value);
        }
        genAISchema[fieldName] = dictSchemaFieldValue;
      } else {
        if (fieldName === "additionalProperties") {
          continue;
        }
        genAISchema[fieldName] = fieldValue;
      }
    }
    return genAISchema;
  }
  function tSchema(schema) {
    return processJsonSchema(schema);
  }
  function tSpeechConfig(speechConfig) {
    if (typeof speechConfig === "object") {
      return speechConfig;
    } else if (typeof speechConfig === "string") {
      return {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: speechConfig
          }
        }
      };
    } else {
      throw new Error(`Unsupported speechConfig type: ${typeof speechConfig}`);
    }
  }
  function tLiveSpeechConfig(speechConfig) {
    if ("multiSpeakerVoiceConfig" in speechConfig) {
      throw new Error("multiSpeakerVoiceConfig is not supported in the live API.");
    }
    return speechConfig;
  }
  function tTool(tool) {
    if (tool.functionDeclarations) {
      for (const functionDeclaration of tool.functionDeclarations) {
        if (functionDeclaration.parameters) {
          if (!Object.keys(functionDeclaration.parameters).includes("$schema")) {
            functionDeclaration.parameters = processJsonSchema(functionDeclaration.parameters);
          } else {
            if (!functionDeclaration.parametersJsonSchema) {
              functionDeclaration.parametersJsonSchema = functionDeclaration.parameters;
              delete functionDeclaration.parameters;
            }
          }
        }
        if (functionDeclaration.response) {
          if (!Object.keys(functionDeclaration.response).includes("$schema")) {
            functionDeclaration.response = processJsonSchema(functionDeclaration.response);
          } else {
            if (!functionDeclaration.responseJsonSchema) {
              functionDeclaration.responseJsonSchema = functionDeclaration.response;
              delete functionDeclaration.response;
            }
          }
        }
      }
    }
    return tool;
  }
  function tTools(tools) {
    if (tools === void 0 || tools === null) {
      throw new Error("tools is required");
    }
    if (!Array.isArray(tools)) {
      throw new Error("tools is required and must be an array of Tools");
    }
    const result = [];
    for (const tool of tools) {
      result.push(tool);
    }
    return result;
  }
  function resourceName(client, resourceName2, resourcePrefix, splitsAfterPrefix = 1) {
    const shouldAppendPrefix = !resourceName2.startsWith(`${resourcePrefix}/`) && resourceName2.split("/").length === splitsAfterPrefix;
    if (client.isVertexAI()) {
      if (resourceName2.startsWith("projects/")) {
        return resourceName2;
      } else if (resourceName2.startsWith("locations/")) {
        return `projects/${client.getProject()}/${resourceName2}`;
      } else if (resourceName2.startsWith(`${resourcePrefix}/`)) {
        return `projects/${client.getProject()}/locations/${client.getLocation()}/${resourceName2}`;
      } else if (shouldAppendPrefix) {
        return `projects/${client.getProject()}/locations/${client.getLocation()}/${resourcePrefix}/${resourceName2}`;
      } else {
        return resourceName2;
      }
    }
    if (shouldAppendPrefix) {
      return `${resourcePrefix}/${resourceName2}`;
    }
    return resourceName2;
  }
  function tCachedContentName(apiClient, name) {
    if (typeof name !== "string") {
      throw new Error("name must be a string");
    }
    return resourceName(apiClient, name, "cachedContents");
  }
  function tTuningJobStatus(status) {
    switch (status) {
      case "STATE_UNSPECIFIED":
        return "JOB_STATE_UNSPECIFIED";
      case "CREATING":
        return "JOB_STATE_RUNNING";
      case "ACTIVE":
        return "JOB_STATE_SUCCEEDED";
      case "FAILED":
        return "JOB_STATE_FAILED";
      default:
        return status;
    }
  }
  function tBytes(fromImageBytes) {
    return tBytes$1(fromImageBytes);
  }
  function _isFile(origin) {
    return origin !== null && origin !== void 0 && typeof origin === "object" && "name" in origin;
  }
  function isGeneratedVideo(origin) {
    return origin !== null && origin !== void 0 && typeof origin === "object" && "video" in origin;
  }
  function isVideo(origin) {
    return origin !== null && origin !== void 0 && typeof origin === "object" && "uri" in origin;
  }
  function tFileName(fromName) {
    var _a2;
    let name;
    if (_isFile(fromName)) {
      name = fromName.name;
    }
    if (isVideo(fromName)) {
      name = fromName.uri;
      if (name === void 0) {
        return void 0;
      }
    }
    if (isGeneratedVideo(fromName)) {
      name = (_a2 = fromName.video) === null || _a2 === void 0 ? void 0 : _a2.uri;
      if (name === void 0) {
        return void 0;
      }
    }
    if (typeof fromName === "string") {
      name = fromName;
    }
    if (name === void 0) {
      throw new Error("Could not extract file name from the provided input.");
    }
    if (name.startsWith("https://")) {
      const suffix = name.split("files/")[1];
      const match2 = suffix.match(/[a-z0-9]+/);
      if (match2 === null) {
        throw new Error(`Could not extract file name from URI ${name}`);
      }
      name = match2[0];
    } else if (name.startsWith("files/")) {
      name = name.split("files/")[1];
    }
    return name;
  }
  function tModelsUrl(apiClient, baseModels) {
    let res;
    if (apiClient.isVertexAI()) {
      res = baseModels ? "publishers/google/models" : "models";
    } else {
      res = baseModels ? "models" : "tunedModels";
    }
    return res;
  }
  function tExtractModels(response) {
    for (const key of ["models", "tunedModels", "publisherModels"]) {
      if (hasField(response, key)) {
        return response[key];
      }
    }
    return [];
  }
  function hasField(data, fieldName) {
    return data !== null && typeof data === "object" && fieldName in data;
  }
  function mcpToGeminiTool(mcpTool, config = {}) {
    const mcpToolSchema = mcpTool;
    const functionDeclaration = {
      name: mcpToolSchema["name"],
      description: mcpToolSchema["description"],
      parametersJsonSchema: mcpToolSchema["inputSchema"]
    };
    if (mcpToolSchema["outputSchema"]) {
      functionDeclaration["responseJsonSchema"] = mcpToolSchema["outputSchema"];
    }
    if (config.behavior) {
      functionDeclaration["behavior"] = config.behavior;
    }
    const geminiTool = {
      functionDeclarations: [
        functionDeclaration
      ]
    };
    return geminiTool;
  }
  function mcpToolsToGeminiTool(mcpTools, config = {}) {
    const functionDeclarations = [];
    const toolNames = /* @__PURE__ */ new Set();
    for (const mcpTool of mcpTools) {
      const mcpToolName = mcpTool.name;
      if (toolNames.has(mcpToolName)) {
        throw new Error(`Duplicate function name ${mcpToolName} found in MCP tools. Please ensure function names are unique.`);
      }
      toolNames.add(mcpToolName);
      const geminiTool = mcpToGeminiTool(mcpTool, config);
      if (geminiTool.functionDeclarations) {
        functionDeclarations.push(...geminiTool.functionDeclarations);
      }
    }
    return { functionDeclarations };
  }
  function tBatchJobSource(client, src) {
    let sourceObj;
    if (typeof src === "string") {
      if (client.isVertexAI()) {
        if (src.startsWith("gs://")) {
          sourceObj = { format: "jsonl", gcsUri: [src] };
        } else if (src.startsWith("bq://")) {
          sourceObj = { format: "bigquery", bigqueryUri: src };
        } else if (/^projects\/[^/]+\/locations\/[^/]+\/datasets\/[^/]+$/.test(src)) {
          sourceObj = { format: "vertex-dataset", vertexDatasetName: src };
        } else {
          throw new Error(`Unsupported string source for Vertex AI: ${src}`);
        }
      } else {
        if (src.startsWith("files/")) {
          sourceObj = { fileName: src };
        } else {
          throw new Error(`Unsupported string source for Gemini API: ${src}`);
        }
      }
    } else if (Array.isArray(src)) {
      if (client.isVertexAI()) {
        throw new Error("InlinedRequest[] is not supported in Vertex AI.");
      }
      sourceObj = { inlinedRequests: src };
    } else {
      sourceObj = src;
    }
    const vertexSourcesCount = [
      sourceObj.gcsUri,
      sourceObj.bigqueryUri,
      sourceObj.vertexDatasetName
    ].filter(Boolean).length;
    const mldevSourcesCount = [
      sourceObj.inlinedRequests,
      sourceObj.fileName
    ].filter(Boolean).length;
    if (client.isVertexAI()) {
      if (mldevSourcesCount > 0 || vertexSourcesCount !== 1) {
        throw new Error("Exactly one of `gcsUri`, `bigqueryUri`, or `vertexDatasetName` must be set for Vertex AI.");
      }
    } else {
      if (vertexSourcesCount > 0 || mldevSourcesCount !== 1) {
        throw new Error("Exactly one of `inlinedRequests`, `fileName`, must be set for Gemini API.");
      }
    }
    return sourceObj;
  }
  function tBatchJobDestination(dest) {
    if (typeof dest !== "string") {
      return dest;
    }
    const destString = dest;
    if (destString.startsWith("gs://")) {
      return {
        format: "jsonl",
        gcsUri: destString
      };
    } else if (destString.startsWith("bq://")) {
      return {
        format: "bigquery",
        bigqueryUri: destString
      };
    } else {
      throw new Error(`Unsupported destination: ${destString}`);
    }
  }
  function tRecvBatchJobDestination(dest) {
    if (typeof dest !== "object" || dest === null) {
      return {};
    }
    const obj = dest;
    const inlineResponsesVal = obj["inlinedResponses"];
    if (typeof inlineResponsesVal !== "object" || inlineResponsesVal === null) {
      return dest;
    }
    const inlineResponsesObj = inlineResponsesVal;
    const responsesArray = inlineResponsesObj["inlinedResponses"];
    if (!Array.isArray(responsesArray) || responsesArray.length === 0) {
      return dest;
    }
    let hasEmbedding = false;
    for (const responseItem of responsesArray) {
      if (typeof responseItem !== "object" || responseItem === null) {
        continue;
      }
      const responseItemObj = responseItem;
      const responseVal = responseItemObj["response"];
      if (typeof responseVal !== "object" || responseVal === null) {
        continue;
      }
      const responseObj = responseVal;
      if (responseObj["embedding"] !== void 0) {
        hasEmbedding = true;
        break;
      }
    }
    if (hasEmbedding) {
      obj["inlinedEmbedContentResponses"] = obj["inlinedResponses"];
      delete obj["inlinedResponses"];
    }
    return dest;
  }
  function tBatchJobName(apiClient, name) {
    const nameString = name;
    if (!apiClient.isVertexAI()) {
      const mldevPattern = /batches\/[^/]+$/;
      if (mldevPattern.test(nameString)) {
        return nameString.split("/").pop();
      } else {
        throw new Error(`Invalid batch job name: ${nameString}.`);
      }
    }
    const vertexPattern = /^projects\/[^/]+\/locations\/[^/]+\/batchPredictionJobs\/[^/]+$/;
    if (vertexPattern.test(nameString)) {
      return nameString.split("/").pop();
    } else if (/^\d+$/.test(nameString)) {
      return nameString;
    } else {
      throw new Error(`Invalid batch job name: ${nameString}.`);
    }
  }
  function tJobState(state) {
    const stateString = state;
    if (stateString === "BATCH_STATE_UNSPECIFIED") {
      return "JOB_STATE_UNSPECIFIED";
    } else if (stateString === "BATCH_STATE_PENDING") {
      return "JOB_STATE_PENDING";
    } else if (stateString === "BATCH_STATE_RUNNING") {
      return "JOB_STATE_RUNNING";
    } else if (stateString === "BATCH_STATE_SUCCEEDED") {
      return "JOB_STATE_SUCCEEDED";
    } else if (stateString === "BATCH_STATE_FAILED") {
      return "JOB_STATE_FAILED";
    } else if (stateString === "BATCH_STATE_CANCELLED") {
      return "JOB_STATE_CANCELLED";
    } else if (stateString === "BATCH_STATE_EXPIRED") {
      return "JOB_STATE_EXPIRED";
    } else {
      return stateString;
    }
  }
  function tIsVertexEmbedContentModel(model) {
    return model.includes("gemini") && model !== "gemini-embedding-001" || model.includes("maas");
  }
  function authConfigToMldev$4(fromObject) {
    const toObject = {};
    const fromApiKey = getValueByPath(fromObject, ["apiKey"]);
    if (fromApiKey != null) {
      setValueByPath(toObject, ["apiKey"], fromApiKey);
    }
    if (getValueByPath(fromObject, ["apiKeyConfig"]) !== void 0) {
      throw new Error("apiKeyConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["authType"]) !== void 0) {
      throw new Error("authType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["googleServiceAccountConfig"]) !== void 0) {
      throw new Error("googleServiceAccountConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["httpBasicAuthConfig"]) !== void 0) {
      throw new Error("httpBasicAuthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oauthConfig"]) !== void 0) {
      throw new Error("oauthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oidcConfig"]) !== void 0) {
      throw new Error("oidcConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function batchJobDestinationFromMldev(fromObject) {
    const toObject = {};
    const fromFileName = getValueByPath(fromObject, ["responsesFile"]);
    if (fromFileName != null) {
      setValueByPath(toObject, ["fileName"], fromFileName);
    }
    const fromInlinedResponses = getValueByPath(fromObject, [
      "inlinedResponses",
      "inlinedResponses"
    ]);
    if (fromInlinedResponses != null) {
      let transformedList = fromInlinedResponses;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return inlinedResponseFromMldev(item);
        });
      }
      setValueByPath(toObject, ["inlinedResponses"], transformedList);
    }
    const fromInlinedEmbedContentResponses = getValueByPath(fromObject, [
      "inlinedEmbedContentResponses",
      "inlinedResponses"
    ]);
    if (fromInlinedEmbedContentResponses != null) {
      let transformedList = fromInlinedEmbedContentResponses;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["inlinedEmbedContentResponses"], transformedList);
    }
    return toObject;
  }
  function batchJobDestinationFromVertex(fromObject) {
    const toObject = {};
    const fromFormat = getValueByPath(fromObject, ["predictionsFormat"]);
    if (fromFormat != null) {
      setValueByPath(toObject, ["format"], fromFormat);
    }
    const fromGcsUri = getValueByPath(fromObject, [
      "gcsDestination",
      "outputUriPrefix"
    ]);
    if (fromGcsUri != null) {
      setValueByPath(toObject, ["gcsUri"], fromGcsUri);
    }
    const fromBigqueryUri = getValueByPath(fromObject, [
      "bigqueryDestination",
      "outputUri"
    ]);
    if (fromBigqueryUri != null) {
      setValueByPath(toObject, ["bigqueryUri"], fromBigqueryUri);
    }
    const fromVertexDataset = getValueByPath(fromObject, [
      "vertexMultimodalDatasetDestination"
    ]);
    if (fromVertexDataset != null) {
      setValueByPath(toObject, ["vertexDataset"], vertexMultimodalDatasetDestinationFromVertex(fromVertexDataset));
    }
    return toObject;
  }
  function batchJobDestinationToVertex(fromObject) {
    const toObject = {};
    const fromFormat = getValueByPath(fromObject, ["format"]);
    if (fromFormat != null) {
      setValueByPath(toObject, ["predictionsFormat"], fromFormat);
    }
    const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
    if (fromGcsUri != null) {
      setValueByPath(toObject, ["gcsDestination", "outputUriPrefix"], fromGcsUri);
    }
    const fromBigqueryUri = getValueByPath(fromObject, ["bigqueryUri"]);
    if (fromBigqueryUri != null) {
      setValueByPath(toObject, ["bigqueryDestination", "outputUri"], fromBigqueryUri);
    }
    if (getValueByPath(fromObject, ["fileName"]) !== void 0) {
      throw new Error("fileName parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["inlinedResponses"]) !== void 0) {
      throw new Error("inlinedResponses parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["inlinedEmbedContentResponses"]) !== void 0) {
      throw new Error("inlinedEmbedContentResponses parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    const fromVertexDataset = getValueByPath(fromObject, [
      "vertexDataset"
    ]);
    if (fromVertexDataset != null) {
      setValueByPath(toObject, ["vertexMultimodalDatasetDestination"], vertexMultimodalDatasetDestinationToVertex(fromVertexDataset));
    }
    return toObject;
  }
  function batchJobFromMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromDisplayName = getValueByPath(fromObject, [
      "metadata",
      "displayName"
    ]);
    if (fromDisplayName != null) {
      setValueByPath(toObject, ["displayName"], fromDisplayName);
    }
    const fromState = getValueByPath(fromObject, ["metadata", "state"]);
    if (fromState != null) {
      setValueByPath(toObject, ["state"], tJobState(fromState));
    }
    const fromCreateTime = getValueByPath(fromObject, [
      "metadata",
      "createTime"
    ]);
    if (fromCreateTime != null) {
      setValueByPath(toObject, ["createTime"], fromCreateTime);
    }
    const fromEndTime = getValueByPath(fromObject, [
      "metadata",
      "endTime"
    ]);
    if (fromEndTime != null) {
      setValueByPath(toObject, ["endTime"], fromEndTime);
    }
    const fromUpdateTime = getValueByPath(fromObject, [
      "metadata",
      "updateTime"
    ]);
    if (fromUpdateTime != null) {
      setValueByPath(toObject, ["updateTime"], fromUpdateTime);
    }
    const fromModel = getValueByPath(fromObject, ["metadata", "model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["model"], fromModel);
    }
    const fromDest = getValueByPath(fromObject, ["metadata", "output"]);
    if (fromDest != null) {
      setValueByPath(toObject, ["dest"], batchJobDestinationFromMldev(tRecvBatchJobDestination(fromDest)));
    }
    return toObject;
  }
  function batchJobFromVertex(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (fromDisplayName != null) {
      setValueByPath(toObject, ["displayName"], fromDisplayName);
    }
    const fromState = getValueByPath(fromObject, ["state"]);
    if (fromState != null) {
      setValueByPath(toObject, ["state"], tJobState(fromState));
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromCreateTime = getValueByPath(fromObject, ["createTime"]);
    if (fromCreateTime != null) {
      setValueByPath(toObject, ["createTime"], fromCreateTime);
    }
    const fromStartTime = getValueByPath(fromObject, ["startTime"]);
    if (fromStartTime != null) {
      setValueByPath(toObject, ["startTime"], fromStartTime);
    }
    const fromEndTime = getValueByPath(fromObject, ["endTime"]);
    if (fromEndTime != null) {
      setValueByPath(toObject, ["endTime"], fromEndTime);
    }
    const fromUpdateTime = getValueByPath(fromObject, ["updateTime"]);
    if (fromUpdateTime != null) {
      setValueByPath(toObject, ["updateTime"], fromUpdateTime);
    }
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["model"], fromModel);
    }
    const fromSrc = getValueByPath(fromObject, ["inputConfig"]);
    if (fromSrc != null) {
      setValueByPath(toObject, ["src"], batchJobSourceFromVertex(fromSrc));
    }
    const fromDest = getValueByPath(fromObject, ["outputConfig"]);
    if (fromDest != null) {
      setValueByPath(toObject, ["dest"], batchJobDestinationFromVertex(tRecvBatchJobDestination(fromDest)));
    }
    const fromCompletionStats = getValueByPath(fromObject, [
      "completionStats"
    ]);
    if (fromCompletionStats != null) {
      setValueByPath(toObject, ["completionStats"], fromCompletionStats);
    }
    const fromOutputInfo = getValueByPath(fromObject, ["outputInfo"]);
    if (fromOutputInfo != null) {
      setValueByPath(toObject, ["outputInfo"], fromOutputInfo);
    }
    return toObject;
  }
  function batchJobSourceFromVertex(fromObject) {
    const toObject = {};
    const fromFormat = getValueByPath(fromObject, ["instancesFormat"]);
    if (fromFormat != null) {
      setValueByPath(toObject, ["format"], fromFormat);
    }
    const fromGcsUri = getValueByPath(fromObject, ["gcsSource", "uris"]);
    if (fromGcsUri != null) {
      setValueByPath(toObject, ["gcsUri"], fromGcsUri);
    }
    const fromBigqueryUri = getValueByPath(fromObject, [
      "bigquerySource",
      "inputUri"
    ]);
    if (fromBigqueryUri != null) {
      setValueByPath(toObject, ["bigqueryUri"], fromBigqueryUri);
    }
    const fromVertexDatasetName = getValueByPath(fromObject, [
      "vertexMultimodalDatasetSource",
      "datasetName"
    ]);
    if (fromVertexDatasetName != null) {
      setValueByPath(toObject, ["vertexDatasetName"], fromVertexDatasetName);
    }
    return toObject;
  }
  function batchJobSourceToMldev(apiClient, fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["format"]) !== void 0) {
      throw new Error("format parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["gcsUri"]) !== void 0) {
      throw new Error("gcsUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["bigqueryUri"]) !== void 0) {
      throw new Error("bigqueryUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFileName = getValueByPath(fromObject, ["fileName"]);
    if (fromFileName != null) {
      setValueByPath(toObject, ["fileName"], fromFileName);
    }
    const fromInlinedRequests = getValueByPath(fromObject, [
      "inlinedRequests"
    ]);
    if (fromInlinedRequests != null) {
      let transformedList = fromInlinedRequests;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return inlinedRequestToMldev(apiClient, item);
        });
      }
      setValueByPath(toObject, ["requests", "requests"], transformedList);
    }
    if (getValueByPath(fromObject, ["vertexDatasetName"]) !== void 0) {
      throw new Error("vertexDatasetName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function batchJobSourceToVertex(fromObject) {
    const toObject = {};
    const fromFormat = getValueByPath(fromObject, ["format"]);
    if (fromFormat != null) {
      setValueByPath(toObject, ["instancesFormat"], fromFormat);
    }
    const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
    if (fromGcsUri != null) {
      setValueByPath(toObject, ["gcsSource", "uris"], fromGcsUri);
    }
    const fromBigqueryUri = getValueByPath(fromObject, ["bigqueryUri"]);
    if (fromBigqueryUri != null) {
      setValueByPath(toObject, ["bigquerySource", "inputUri"], fromBigqueryUri);
    }
    if (getValueByPath(fromObject, ["fileName"]) !== void 0) {
      throw new Error("fileName parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["inlinedRequests"]) !== void 0) {
      throw new Error("inlinedRequests parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    const fromVertexDatasetName = getValueByPath(fromObject, [
      "vertexDatasetName"
    ]);
    if (fromVertexDatasetName != null) {
      setValueByPath(toObject, ["vertexMultimodalDatasetSource", "datasetName"], fromVertexDatasetName);
    }
    return toObject;
  }
  function blobToMldev$4(fromObject) {
    const toObject = {};
    const fromData = getValueByPath(fromObject, ["data"]);
    if (fromData != null) {
      setValueByPath(toObject, ["data"], fromData);
    }
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function cancelBatchJobParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tBatchJobName(apiClient, fromName));
    }
    return toObject;
  }
  function cancelBatchJobParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tBatchJobName(apiClient, fromName));
    }
    return toObject;
  }
  function candidateFromMldev$1(fromObject) {
    const toObject = {};
    const fromContent = getValueByPath(fromObject, ["content"]);
    if (fromContent != null) {
      setValueByPath(toObject, ["content"], fromContent);
    }
    const fromCitationMetadata = getValueByPath(fromObject, [
      "citationMetadata"
    ]);
    if (fromCitationMetadata != null) {
      setValueByPath(toObject, ["citationMetadata"], citationMetadataFromMldev$1(fromCitationMetadata));
    }
    const fromTokenCount = getValueByPath(fromObject, ["tokenCount"]);
    if (fromTokenCount != null) {
      setValueByPath(toObject, ["tokenCount"], fromTokenCount);
    }
    const fromFinishReason = getValueByPath(fromObject, ["finishReason"]);
    if (fromFinishReason != null) {
      setValueByPath(toObject, ["finishReason"], fromFinishReason);
    }
    const fromGroundingMetadata = getValueByPath(fromObject, [
      "groundingMetadata"
    ]);
    if (fromGroundingMetadata != null) {
      setValueByPath(toObject, ["groundingMetadata"], fromGroundingMetadata);
    }
    const fromAvgLogprobs = getValueByPath(fromObject, ["avgLogprobs"]);
    if (fromAvgLogprobs != null) {
      setValueByPath(toObject, ["avgLogprobs"], fromAvgLogprobs);
    }
    const fromIndex = getValueByPath(fromObject, ["index"]);
    if (fromIndex != null) {
      setValueByPath(toObject, ["index"], fromIndex);
    }
    const fromLogprobsResult = getValueByPath(fromObject, [
      "logprobsResult"
    ]);
    if (fromLogprobsResult != null) {
      setValueByPath(toObject, ["logprobsResult"], fromLogprobsResult);
    }
    const fromSafetyRatings = getValueByPath(fromObject, [
      "safetyRatings"
    ]);
    if (fromSafetyRatings != null) {
      let transformedList = fromSafetyRatings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["safetyRatings"], transformedList);
    }
    const fromUrlContextMetadata = getValueByPath(fromObject, [
      "urlContextMetadata"
    ]);
    if (fromUrlContextMetadata != null) {
      setValueByPath(toObject, ["urlContextMetadata"], fromUrlContextMetadata);
    }
    return toObject;
  }
  function citationMetadataFromMldev$1(fromObject) {
    const toObject = {};
    const fromCitations = getValueByPath(fromObject, ["citationSources"]);
    if (fromCitations != null) {
      let transformedList = fromCitations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["citations"], transformedList);
    }
    return toObject;
  }
  function contentToMldev$4(fromObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToMldev$4(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function createBatchJobConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["batch", "displayName"], fromDisplayName);
    }
    if (getValueByPath(fromObject, ["dest"]) !== void 0) {
      throw new Error("dest parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromWebhookConfig = getValueByPath(fromObject, [
      "webhookConfig"
    ]);
    if (parentObject !== void 0 && fromWebhookConfig != null) {
      setValueByPath(parentObject, ["batch", "webhookConfig"], fromWebhookConfig);
    }
    return toObject;
  }
  function createBatchJobConfigToVertex(fromObject, parentObject) {
    const toObject = {};
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromDisplayName);
    }
    const fromDest = getValueByPath(fromObject, ["dest"]);
    if (parentObject !== void 0 && fromDest != null) {
      setValueByPath(parentObject, ["outputConfig"], batchJobDestinationToVertex(tBatchJobDestination(fromDest)));
    }
    if (getValueByPath(fromObject, ["webhookConfig"]) !== void 0) {
      throw new Error("webhookConfig parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function createBatchJobParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromSrc = getValueByPath(fromObject, ["src"]);
    if (fromSrc != null) {
      setValueByPath(toObject, ["batch", "inputConfig"], batchJobSourceToMldev(apiClient, tBatchJobSource(apiClient, fromSrc)));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createBatchJobConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function createBatchJobParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["model"], tModel(apiClient, fromModel));
    }
    const fromSrc = getValueByPath(fromObject, ["src"]);
    if (fromSrc != null) {
      setValueByPath(toObject, ["inputConfig"], batchJobSourceToVertex(tBatchJobSource(apiClient, fromSrc)));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createBatchJobConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function createEmbeddingsBatchJobConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["batch", "displayName"], fromDisplayName);
    }
    return toObject;
  }
  function createEmbeddingsBatchJobParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromSrc = getValueByPath(fromObject, ["src"]);
    if (fromSrc != null) {
      setValueByPath(toObject, ["batch", "inputConfig"], embeddingsBatchJobSourceToMldev(apiClient, fromSrc));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createEmbeddingsBatchJobConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function deleteBatchJobParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tBatchJobName(apiClient, fromName));
    }
    return toObject;
  }
  function deleteBatchJobParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tBatchJobName(apiClient, fromName));
    }
    return toObject;
  }
  function deleteResourceJobFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    return toObject;
  }
  function deleteResourceJobFromVertex(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    return toObject;
  }
  function embedContentBatchToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContentsForEmbed(apiClient, fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["requests[]", "request", "content"], transformedList);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["_self"], embedContentConfigToMldev$1(fromConfig, toObject));
      moveValueByPath(toObject, { "requests[].*": "requests[].request.*" });
    }
    return toObject;
  }
  function embedContentConfigToMldev$1(fromObject, parentObject) {
    const toObject = {};
    const fromTaskType = getValueByPath(fromObject, ["taskType"]);
    if (parentObject !== void 0 && fromTaskType != null) {
      setValueByPath(parentObject, ["requests[]", "taskType"], fromTaskType);
    }
    const fromTitle = getValueByPath(fromObject, ["title"]);
    if (parentObject !== void 0 && fromTitle != null) {
      setValueByPath(parentObject, ["requests[]", "title"], fromTitle);
    }
    const fromOutputDimensionality = getValueByPath(fromObject, [
      "outputDimensionality"
    ]);
    if (parentObject !== void 0 && fromOutputDimensionality != null) {
      setValueByPath(parentObject, ["requests[]", "outputDimensionality"], fromOutputDimensionality);
    }
    if (getValueByPath(fromObject, ["mimeType"]) !== void 0) {
      throw new Error("mimeType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["autoTruncate"]) !== void 0) {
      throw new Error("autoTruncate parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["documentOcr"]) !== void 0) {
      throw new Error("documentOcr parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["audioTrackExtraction"]) !== void 0) {
      throw new Error("audioTrackExtraction parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function embeddingsBatchJobSourceToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromFileName = getValueByPath(fromObject, ["fileName"]);
    if (fromFileName != null) {
      setValueByPath(toObject, ["file_name"], fromFileName);
    }
    const fromInlinedRequests = getValueByPath(fromObject, [
      "inlinedRequests"
    ]);
    if (fromInlinedRequests != null) {
      setValueByPath(toObject, ["requests"], embedContentBatchToMldev(apiClient, fromInlinedRequests));
    }
    return toObject;
  }
  function fileDataToMldev$4(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFileUri = getValueByPath(fromObject, ["fileUri"]);
    if (fromFileUri != null) {
      setValueByPath(toObject, ["fileUri"], fromFileUri);
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function functionCallToMldev$4(fromObject) {
    const toObject = {};
    const fromId = getValueByPath(fromObject, ["id"]);
    if (fromId != null) {
      setValueByPath(toObject, ["id"], fromId);
    }
    const fromArgs = getValueByPath(fromObject, ["args"]);
    if (fromArgs != null) {
      setValueByPath(toObject, ["args"], fromArgs);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    if (getValueByPath(fromObject, ["partialArgs"]) !== void 0) {
      throw new Error("partialArgs parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["willContinue"]) !== void 0) {
      throw new Error("willContinue parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function functionCallingConfigToMldev$2(fromObject) {
    const toObject = {};
    const fromAllowedFunctionNames = getValueByPath(fromObject, [
      "allowedFunctionNames"
    ]);
    if (fromAllowedFunctionNames != null) {
      setValueByPath(toObject, ["allowedFunctionNames"], fromAllowedFunctionNames);
    }
    const fromMode = getValueByPath(fromObject, ["mode"]);
    if (fromMode != null) {
      setValueByPath(toObject, ["mode"], fromMode);
    }
    if (getValueByPath(fromObject, ["streamFunctionCallArguments"]) !== void 0) {
      throw new Error("streamFunctionCallArguments parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function generateContentConfigToMldev$1(apiClient, fromObject, parentObject) {
    const toObject = {};
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["systemInstruction"], contentToMldev$4(tContent(fromSystemInstruction)));
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (fromTemperature != null) {
      setValueByPath(toObject, ["temperature"], fromTemperature);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (fromTopP != null) {
      setValueByPath(toObject, ["topP"], fromTopP);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (fromTopK != null) {
      setValueByPath(toObject, ["topK"], fromTopK);
    }
    const fromCandidateCount = getValueByPath(fromObject, [
      "candidateCount"
    ]);
    if (fromCandidateCount != null) {
      setValueByPath(toObject, ["candidateCount"], fromCandidateCount);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (fromMaxOutputTokens != null) {
      setValueByPath(toObject, ["maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromStopSequences = getValueByPath(fromObject, [
      "stopSequences"
    ]);
    if (fromStopSequences != null) {
      setValueByPath(toObject, ["stopSequences"], fromStopSequences);
    }
    const fromResponseLogprobs = getValueByPath(fromObject, [
      "responseLogprobs"
    ]);
    if (fromResponseLogprobs != null) {
      setValueByPath(toObject, ["responseLogprobs"], fromResponseLogprobs);
    }
    const fromLogprobs = getValueByPath(fromObject, ["logprobs"]);
    if (fromLogprobs != null) {
      setValueByPath(toObject, ["logprobs"], fromLogprobs);
    }
    const fromPresencePenalty = getValueByPath(fromObject, [
      "presencePenalty"
    ]);
    if (fromPresencePenalty != null) {
      setValueByPath(toObject, ["presencePenalty"], fromPresencePenalty);
    }
    const fromFrequencyPenalty = getValueByPath(fromObject, [
      "frequencyPenalty"
    ]);
    if (fromFrequencyPenalty != null) {
      setValueByPath(toObject, ["frequencyPenalty"], fromFrequencyPenalty);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (fromSeed != null) {
      setValueByPath(toObject, ["seed"], fromSeed);
    }
    const fromResponseMimeType = getValueByPath(fromObject, [
      "responseMimeType"
    ]);
    if (fromResponseMimeType != null) {
      setValueByPath(toObject, ["responseMimeType"], fromResponseMimeType);
    }
    const fromResponseSchema = getValueByPath(fromObject, [
      "responseSchema"
    ]);
    if (fromResponseSchema != null) {
      setValueByPath(toObject, ["responseSchema"], tSchema(fromResponseSchema));
    }
    const fromResponseJsonSchema = getValueByPath(fromObject, [
      "responseJsonSchema"
    ]);
    if (fromResponseJsonSchema != null) {
      setValueByPath(toObject, ["responseJsonSchema"], fromResponseJsonSchema);
    }
    if (getValueByPath(fromObject, ["routingConfig"]) !== void 0) {
      throw new Error("routingConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["modelSelectionConfig"]) !== void 0) {
      throw new Error("modelSelectionConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromSafetySettings = getValueByPath(fromObject, [
      "safetySettings"
    ]);
    if (parentObject !== void 0 && fromSafetySettings != null) {
      let transformedList = fromSafetySettings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return safetySettingToMldev$3(item);
        });
      }
      setValueByPath(parentObject, ["safetySettings"], transformedList);
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = tTools(fromTools);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToMldev$4(tTool(item));
        });
      }
      setValueByPath(parentObject, ["tools"], transformedList);
    }
    const fromToolConfig = getValueByPath(fromObject, ["toolConfig"]);
    if (parentObject !== void 0 && fromToolConfig != null) {
      setValueByPath(parentObject, ["toolConfig"], toolConfigToMldev$2(fromToolConfig));
    }
    if (getValueByPath(fromObject, ["labels"]) !== void 0) {
      throw new Error("labels parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromCachedContent = getValueByPath(fromObject, [
      "cachedContent"
    ]);
    if (parentObject !== void 0 && fromCachedContent != null) {
      setValueByPath(parentObject, ["cachedContent"], tCachedContentName(apiClient, fromCachedContent));
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (fromResponseModalities != null) {
      setValueByPath(toObject, ["responseModalities"], fromResponseModalities);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (fromSpeechConfig != null) {
      setValueByPath(toObject, ["speechConfig"], tSpeechConfig(fromSpeechConfig));
    }
    if (getValueByPath(fromObject, ["audioTimestamp"]) !== void 0) {
      throw new Error("audioTimestamp parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (fromThinkingConfig != null) {
      setValueByPath(toObject, ["thinkingConfig"], fromThinkingConfig);
    }
    const fromImageConfig = getValueByPath(fromObject, ["imageConfig"]);
    if (fromImageConfig != null) {
      setValueByPath(toObject, ["imageConfig"], imageConfigToMldev$1(fromImageConfig));
    }
    const fromEnableEnhancedCivicAnswers = getValueByPath(fromObject, [
      "enableEnhancedCivicAnswers"
    ]);
    if (fromEnableEnhancedCivicAnswers != null) {
      setValueByPath(toObject, ["enableEnhancedCivicAnswers"], fromEnableEnhancedCivicAnswers);
    }
    if (getValueByPath(fromObject, ["modelArmorConfig"]) !== void 0) {
      throw new Error("modelArmorConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromServiceTier = getValueByPath(fromObject, ["serviceTier"]);
    if (parentObject !== void 0 && fromServiceTier != null) {
      setValueByPath(parentObject, ["serviceTier"], fromServiceTier);
    }
    return toObject;
  }
  function generateContentResponseFromMldev$1(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromCandidates = getValueByPath(fromObject, ["candidates"]);
    if (fromCandidates != null) {
      let transformedList = fromCandidates;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return candidateFromMldev$1(item);
        });
      }
      setValueByPath(toObject, ["candidates"], transformedList);
    }
    const fromModelVersion = getValueByPath(fromObject, ["modelVersion"]);
    if (fromModelVersion != null) {
      setValueByPath(toObject, ["modelVersion"], fromModelVersion);
    }
    const fromPromptFeedback = getValueByPath(fromObject, [
      "promptFeedback"
    ]);
    if (fromPromptFeedback != null) {
      setValueByPath(toObject, ["promptFeedback"], fromPromptFeedback);
    }
    const fromResponseId = getValueByPath(fromObject, ["responseId"]);
    if (fromResponseId != null) {
      setValueByPath(toObject, ["responseId"], fromResponseId);
    }
    const fromUsageMetadata = getValueByPath(fromObject, [
      "usageMetadata"
    ]);
    if (fromUsageMetadata != null) {
      setValueByPath(toObject, ["usageMetadata"], fromUsageMetadata);
    }
    const fromModelStatus = getValueByPath(fromObject, ["modelStatus"]);
    if (fromModelStatus != null) {
      setValueByPath(toObject, ["modelStatus"], fromModelStatus);
    }
    return toObject;
  }
  function getBatchJobParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tBatchJobName(apiClient, fromName));
    }
    return toObject;
  }
  function getBatchJobParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tBatchJobName(apiClient, fromName));
    }
    return toObject;
  }
  function googleMapsToMldev$4(fromObject) {
    const toObject = {};
    const fromAuthConfig = getValueByPath(fromObject, ["authConfig"]);
    if (fromAuthConfig != null) {
      setValueByPath(toObject, ["authConfig"], authConfigToMldev$4(fromAuthConfig));
    }
    const fromEnableWidget = getValueByPath(fromObject, ["enableWidget"]);
    if (fromEnableWidget != null) {
      setValueByPath(toObject, ["enableWidget"], fromEnableWidget);
    }
    return toObject;
  }
  function googleSearchToMldev$4(fromObject) {
    const toObject = {};
    const fromSearchTypes = getValueByPath(fromObject, ["searchTypes"]);
    if (fromSearchTypes != null) {
      setValueByPath(toObject, ["searchTypes"], fromSearchTypes);
    }
    if (getValueByPath(fromObject, ["blockingConfidence"]) !== void 0) {
      throw new Error("blockingConfidence parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["excludeDomains"]) !== void 0) {
      throw new Error("excludeDomains parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromTimeRangeFilter = getValueByPath(fromObject, [
      "timeRangeFilter"
    ]);
    if (fromTimeRangeFilter != null) {
      setValueByPath(toObject, ["timeRangeFilter"], fromTimeRangeFilter);
    }
    return toObject;
  }
  function imageConfigToMldev$1(fromObject) {
    const toObject = {};
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (fromAspectRatio != null) {
      setValueByPath(toObject, ["aspectRatio"], fromAspectRatio);
    }
    const fromImageSize = getValueByPath(fromObject, ["imageSize"]);
    if (fromImageSize != null) {
      setValueByPath(toObject, ["imageSize"], fromImageSize);
    }
    if (getValueByPath(fromObject, ["personGeneration"]) !== void 0) {
      throw new Error("personGeneration parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["prominentPeople"]) !== void 0) {
      throw new Error("prominentPeople parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["outputMimeType"]) !== void 0) {
      throw new Error("outputMimeType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["outputCompressionQuality"]) !== void 0) {
      throw new Error("outputCompressionQuality parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["imageOutputOptions"]) !== void 0) {
      throw new Error("imageOutputOptions parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function inlinedRequestToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["request", "model"], tModel(apiClient, fromModel));
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToMldev$4(item);
        });
      }
      setValueByPath(toObject, ["request", "contents"], transformedList);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["request", "generationConfig"], generateContentConfigToMldev$1(apiClient, fromConfig, getValueByPath(toObject, ["request"], {})));
    }
    return toObject;
  }
  function inlinedResponseFromMldev(fromObject) {
    const toObject = {};
    const fromResponse = getValueByPath(fromObject, ["response"]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], generateContentResponseFromMldev$1(fromResponse));
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    return toObject;
  }
  function listBatchJobsConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    if (getValueByPath(fromObject, ["filter"]) !== void 0) {
      throw new Error("filter parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function listBatchJobsConfigToVertex(fromObject, parentObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    const fromFilter = getValueByPath(fromObject, ["filter"]);
    if (parentObject !== void 0 && fromFilter != null) {
      setValueByPath(parentObject, ["_query", "filter"], fromFilter);
    }
    return toObject;
  }
  function listBatchJobsParametersToMldev(fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listBatchJobsConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function listBatchJobsParametersToVertex(fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listBatchJobsConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function listBatchJobsResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromBatchJobs = getValueByPath(fromObject, ["operations"]);
    if (fromBatchJobs != null) {
      let transformedList = fromBatchJobs;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return batchJobFromMldev(item);
        });
      }
      setValueByPath(toObject, ["batchJobs"], transformedList);
    }
    return toObject;
  }
  function listBatchJobsResponseFromVertex(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromBatchJobs = getValueByPath(fromObject, [
      "batchPredictionJobs"
    ]);
    if (fromBatchJobs != null) {
      let transformedList = fromBatchJobs;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return batchJobFromVertex(item);
        });
      }
      setValueByPath(toObject, ["batchJobs"], transformedList);
    }
    return toObject;
  }
  function partToMldev$4(fromObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], fromCodeExecutionResult);
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], fromExecutableCode);
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fileDataToMldev$4(fromFileData));
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], functionCallToMldev$4(fromFunctionCall));
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], blobToMldev$4(fromInlineData));
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    const fromToolCall = getValueByPath(fromObject, ["toolCall"]);
    if (fromToolCall != null) {
      setValueByPath(toObject, ["toolCall"], fromToolCall);
    }
    const fromToolResponse = getValueByPath(fromObject, ["toolResponse"]);
    if (fromToolResponse != null) {
      setValueByPath(toObject, ["toolResponse"], fromToolResponse);
    }
    const fromPartMetadata = getValueByPath(fromObject, ["partMetadata"]);
    if (fromPartMetadata != null) {
      setValueByPath(toObject, ["partMetadata"], fromPartMetadata);
    }
    return toObject;
  }
  function safetySettingToMldev$3(fromObject) {
    const toObject = {};
    const fromCategory = getValueByPath(fromObject, ["category"]);
    if (fromCategory != null) {
      setValueByPath(toObject, ["category"], fromCategory);
    }
    if (getValueByPath(fromObject, ["method"]) !== void 0) {
      throw new Error("method parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromThreshold = getValueByPath(fromObject, ["threshold"]);
    if (fromThreshold != null) {
      setValueByPath(toObject, ["threshold"], fromThreshold);
    }
    return toObject;
  }
  function toolConfigToMldev$2(fromObject) {
    const toObject = {};
    const fromRetrievalConfig = getValueByPath(fromObject, [
      "retrievalConfig"
    ]);
    if (fromRetrievalConfig != null) {
      setValueByPath(toObject, ["retrievalConfig"], fromRetrievalConfig);
    }
    const fromFunctionCallingConfig = getValueByPath(fromObject, [
      "functionCallingConfig"
    ]);
    if (fromFunctionCallingConfig != null) {
      setValueByPath(toObject, ["functionCallingConfig"], functionCallingConfigToMldev$2(fromFunctionCallingConfig));
    }
    const fromIncludeServerSideToolInvocations = getValueByPath(fromObject, ["includeServerSideToolInvocations"]);
    if (fromIncludeServerSideToolInvocations != null) {
      setValueByPath(toObject, ["includeServerSideToolInvocations"], fromIncludeServerSideToolInvocations);
    }
    return toObject;
  }
  function toolToMldev$4(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["retrieval"]) !== void 0) {
      throw new Error("retrieval parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    const fromFileSearch = getValueByPath(fromObject, ["fileSearch"]);
    if (fromFileSearch != null) {
      setValueByPath(toObject, ["fileSearch"], fromFileSearch);
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], googleSearchToMldev$4(fromGoogleSearch));
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], googleMapsToMldev$4(fromGoogleMaps));
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    if (getValueByPath(fromObject, ["enterpriseWebSearch"]) !== void 0) {
      throw new Error("enterpriseWebSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    if (getValueByPath(fromObject, ["parallelAiSearch"]) !== void 0) {
      throw new Error("parallelAiSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function vertexMultimodalDatasetDestinationFromVertex(fromObject) {
    const toObject = {};
    const fromBigqueryDestination = getValueByPath(fromObject, [
      "bigqueryDestination",
      "outputUri"
    ]);
    if (fromBigqueryDestination != null) {
      setValueByPath(toObject, ["bigqueryDestination"], fromBigqueryDestination);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (fromDisplayName != null) {
      setValueByPath(toObject, ["displayName"], fromDisplayName);
    }
    return toObject;
  }
  function vertexMultimodalDatasetDestinationToVertex(fromObject) {
    const toObject = {};
    const fromBigqueryDestination = getValueByPath(fromObject, [
      "bigqueryDestination"
    ]);
    if (fromBigqueryDestination != null) {
      setValueByPath(toObject, ["bigqueryDestination", "outputUri"], fromBigqueryDestination);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (fromDisplayName != null) {
      setValueByPath(toObject, ["displayName"], fromDisplayName);
    }
    return toObject;
  }
  var PagedItem;
  (function(PagedItem2) {
    PagedItem2["PAGED_ITEM_BATCH_JOBS"] = "batchJobs";
    PagedItem2["PAGED_ITEM_MODELS"] = "models";
    PagedItem2["PAGED_ITEM_TUNING_JOBS"] = "tuningJobs";
    PagedItem2["PAGED_ITEM_FILES"] = "files";
    PagedItem2["PAGED_ITEM_CACHED_CONTENTS"] = "cachedContents";
    PagedItem2["PAGED_ITEM_FILE_SEARCH_STORES"] = "fileSearchStores";
    PagedItem2["PAGED_ITEM_DOCUMENTS"] = "documents";
    PagedItem2["PAGED_ITEM_SKILLS"] = "skills";
  })(PagedItem || (PagedItem = {}));
  var Pager = class {
    constructor(name, request, response, params) {
      this.pageInternal = [];
      this.paramsInternal = {};
      this.requestInternal = request;
      this.init(name, response, params);
    }
    init(name, response, params) {
      var _a2, _b;
      this.nameInternal = name;
      this.pageInternal = response[this.nameInternal] || [];
      this.sdkHttpResponseInternal = response === null || response === void 0 ? void 0 : response.sdkHttpResponse;
      this.idxInternal = 0;
      let requestParams = { config: {} };
      if (!params || Object.keys(params).length === 0) {
        requestParams = { config: {} };
      } else if (typeof params === "object") {
        requestParams = Object.assign({}, params);
      } else {
        requestParams = params;
      }
      if (requestParams["config"]) {
        requestParams["config"]["pageToken"] = response["nextPageToken"];
      }
      this.paramsInternal = requestParams;
      this.pageInternalSize = (_b = (_a2 = requestParams["config"]) === null || _a2 === void 0 ? void 0 : _a2["pageSize"]) !== null && _b !== void 0 ? _b : this.pageInternal.length;
    }
    initNextPage(response) {
      this.init(this.nameInternal, response, this.paramsInternal);
    }
    /**
     * Returns the current page, which is a list of items.
     *
     * @remarks
     * The first page is retrieved when the pager is created. The returned list of
     * items could be a subset of the entire list.
     */
    get page() {
      return this.pageInternal;
    }
    /**
     * Returns the type of paged item (for example, ``batch_jobs``).
     */
    get name() {
      return this.nameInternal;
    }
    /**
     * Returns the length of the page fetched each time by this pager.
     *
     * @remarks
     * The number of items in the page is less than or equal to the page length.
     */
    get pageSize() {
      return this.pageInternalSize;
    }
    /**
     * Returns the headers of the API response.
     */
    get sdkHttpResponse() {
      return this.sdkHttpResponseInternal;
    }
    /**
     * Returns the parameters when making the API request for the next page.
     *
     * @remarks
     * Parameters contain a set of optional configs that can be
     * used to customize the API request. For example, the `pageToken` parameter
     * contains the token to request the next page.
     */
    get params() {
      return this.paramsInternal;
    }
    /**
     * Returns the total number of items in the current page.
     */
    get pageLength() {
      return this.pageInternal.length;
    }
    /**
     * Returns the item at the given index.
     */
    getItem(index) {
      return this.pageInternal[index];
    }
    /**
     * Returns an async iterator that support iterating through all items
     * retrieved from the API.
     *
     * @remarks
     * The iterator will automatically fetch the next page if there are more items
     * to fetch from the API.
     *
     * @example
     *
     * ```ts
     * const pager = await ai.files.list({config: {pageSize: 10}});
     * for await (const file of pager) {
     *   console.log(file.name);
     * }
     * ```
     */
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (this.idxInternal >= this.pageLength) {
            if (this.hasNextPage()) {
              await this.nextPage();
            } else {
              return { value: void 0, done: true };
            }
          }
          const item = this.getItem(this.idxInternal);
          this.idxInternal += 1;
          return { value: item, done: false };
        },
        return: async () => {
          return { value: void 0, done: true };
        }
      };
    }
    /**
     * Fetches the next page of items. This makes a new API request.
     *
     * @throws {Error} If there are no more pages to fetch.
     *
     * @example
     *
     * ```ts
     * const pager = await ai.files.list({config: {pageSize: 10}});
     * let page = pager.page;
     * while (true) {
     *   for (const file of page) {
     *     console.log(file.name);
     *   }
     *   if (!pager.hasNextPage()) {
     *     break;
     *   }
     *   page = await pager.nextPage();
     * }
     * ```
     */
    async nextPage() {
      if (!this.hasNextPage()) {
        throw new Error("No more pages to fetch.");
      }
      const response = await this.requestInternal(this.params);
      this.initNextPage(response);
      return this.page;
    }
    /**
     * Returns true if there are more pages to fetch from the API.
     */
    hasNextPage() {
      var _a2;
      if (((_a2 = this.params["config"]) === null || _a2 === void 0 ? void 0 : _a2["pageToken"]) !== void 0) {
        return true;
      }
      return false;
    }
  };
  var Batches = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
      this.list = async (params = {}) => {
        return new Pager(PagedItem.PAGED_ITEM_BATCH_JOBS, (x) => this.listInternal(x), await this.listInternal(params), params);
      };
      this.create = async (params) => {
        if (this.apiClient.isVertexAI()) {
          params.config = this.formatDestination(params.src, params.config);
        }
        return this.createInternal(params);
      };
      this.createEmbeddings = async (params) => {
        console.warn("batches.createEmbeddings() is experimental and may change without notice.");
        if (this.apiClient.isVertexAI()) {
          throw new Error("Gemini Enterprise Agent Platform (previously known as Vertex AI) does not support batches.createEmbeddings.");
        }
        return this.createEmbeddingsInternal(params);
      };
    }
    // Helper function to handle inlined generate content requests
    createInlinedGenerateContentRequest(params) {
      const body = createBatchJobParametersToMldev(
        this.apiClient,
        // Use instance apiClient
        params
      );
      const urlParams = body["_url"];
      const path = formatMap("{model}:batchGenerateContent", urlParams);
      const batch = body["batch"];
      const inputConfig = batch["inputConfig"];
      const requestsWrapper = inputConfig["requests"];
      const requests = requestsWrapper["requests"];
      const newRequests = [];
      for (const request of requests) {
        const requestDict = Object.assign({}, request);
        if (requestDict["systemInstruction"]) {
          const systemInstructionValue = requestDict["systemInstruction"];
          delete requestDict["systemInstruction"];
          const requestContent = requestDict["request"];
          requestContent["systemInstruction"] = systemInstructionValue;
          requestDict["request"] = requestContent;
        }
        newRequests.push(requestDict);
      }
      requestsWrapper["requests"] = newRequests;
      delete body["config"];
      delete body["_url"];
      delete body["_query"];
      return { path, body };
    }
    // Helper function to get the first GCS URI
    getGcsUri(src) {
      if (typeof src === "string") {
        return src.startsWith("gs://") ? src : void 0;
      }
      if (!Array.isArray(src) && src.gcsUri && src.gcsUri.length > 0) {
        return src.gcsUri[0];
      }
      return void 0;
    }
    // Helper function to get the BigQuery URI
    getBigqueryUri(src) {
      if (typeof src === "string") {
        return src.startsWith("bq://") ? src : void 0;
      }
      if (!Array.isArray(src)) {
        return src.bigqueryUri;
      }
      return void 0;
    }
    // Function to format the destination configuration for Vertex AI
    formatDestination(src, config) {
      const newConfig = config ? Object.assign({}, config) : {};
      const timestampStr = Date.now().toString();
      if (!newConfig.displayName) {
        newConfig.displayName = `genaiBatchJob_${timestampStr}`;
      }
      if (newConfig.dest === void 0) {
        const gcsUri = this.getGcsUri(src);
        const bigqueryUri = this.getBigqueryUri(src);
        if (gcsUri) {
          if (gcsUri.endsWith(".jsonl")) {
            newConfig.dest = `${gcsUri.slice(0, -6)}/dest`;
          } else {
            newConfig.dest = `${gcsUri}_dest_${timestampStr}`;
          }
        } else if (bigqueryUri) {
          newConfig.dest = `${bigqueryUri}_dest_${timestampStr}`;
        } else {
          throw new Error("Unsupported source for Gemini Enterprise Agent Platform (previously known as Vertex AI): No GCS or BigQuery URI found.");
        }
      }
      return newConfig;
    }
    /**
     * Internal method to create batch job.
     *
     * @param params - The parameters for create batch job request.
     * @return The created batch job.
     *
     */
    async createInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = createBatchJobParametersToVertex(this.apiClient, params);
        path = formatMap("batchPredictionJobs", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = batchJobFromVertex(apiResponse);
          return resp;
        });
      } else {
        const body = createBatchJobParametersToMldev(this.apiClient, params);
        path = formatMap("{model}:batchGenerateContent", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = batchJobFromMldev(apiResponse);
          return resp;
        });
      }
    }
    /**
     * Internal method to create batch job.
     *
     * @param params - The parameters for create batch job request.
     * @return The created batch job.
     *
     */
    async createEmbeddingsInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = createEmbeddingsBatchJobParametersToMldev(this.apiClient, params);
        path = formatMap("{model}:asyncBatchEmbedContent", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = batchJobFromMldev(apiResponse);
          return resp;
        });
      }
    }
    /**
     * Gets batch job configurations.
     *
     * @param params - The parameters for the get request.
     * @return The batch job.
     *
     * @example
     * ```ts
     * await ai.batches.get({name: '...'}); // The server-generated resource name.
     * ```
     */
    async get(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = getBatchJobParametersToVertex(this.apiClient, params);
        path = formatMap("batchPredictionJobs/{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = batchJobFromVertex(apiResponse);
          return resp;
        });
      } else {
        const body = getBatchJobParametersToMldev(this.apiClient, params);
        path = formatMap("batches/{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = batchJobFromMldev(apiResponse);
          return resp;
        });
      }
    }
    /**
     * Cancels a batch job.
     *
     * @param params - The parameters for the cancel request.
     * @return The empty response returned by the API.
     *
     * @example
     * ```ts
     * await ai.batches.cancel({name: '...'}); // The server-generated resource name.
     * ```
     */
    async cancel(params) {
      var _a2, _b, _c, _d;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = cancelBatchJobParametersToVertex(this.apiClient, params);
        path = formatMap("batchPredictionJobs/{name}:cancel", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        await this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        });
      } else {
        const body = cancelBatchJobParametersToMldev(this.apiClient, params);
        path = formatMap("batches/{name}:cancel", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        await this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        });
      }
    }
    async listInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = listBatchJobsParametersToVertex(params);
        path = formatMap("batchPredictionJobs", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listBatchJobsResponseFromVertex(apiResponse);
          const typedResp = new ListBatchJobsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = listBatchJobsParametersToMldev(params);
        path = formatMap("batches", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listBatchJobsResponseFromMldev(apiResponse);
          const typedResp = new ListBatchJobsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Deletes a batch job.
     *
     * @param params - The parameters for the delete request.
     * @return The empty response returned by the API.
     *
     * @example
     * ```ts
     * await ai.batches.delete({name: '...'}); // The server-generated resource name.
     * ```
     */
    async delete(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = deleteBatchJobParametersToVertex(this.apiClient, params);
        path = formatMap("batchPredictionJobs/{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = deleteResourceJobFromVertex(apiResponse);
          return resp;
        });
      } else {
        const body = deleteBatchJobParametersToMldev(this.apiClient, params);
        path = formatMap("batches/{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = deleteResourceJobFromMldev(apiResponse);
          return resp;
        });
      }
    }
  };
  function authConfigToMldev$3(fromObject) {
    const toObject = {};
    const fromApiKey = getValueByPath(fromObject, ["apiKey"]);
    if (fromApiKey != null) {
      setValueByPath(toObject, ["apiKey"], fromApiKey);
    }
    if (getValueByPath(fromObject, ["apiKeyConfig"]) !== void 0) {
      throw new Error("apiKeyConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["authType"]) !== void 0) {
      throw new Error("authType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["googleServiceAccountConfig"]) !== void 0) {
      throw new Error("googleServiceAccountConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["httpBasicAuthConfig"]) !== void 0) {
      throw new Error("httpBasicAuthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oauthConfig"]) !== void 0) {
      throw new Error("oauthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oidcConfig"]) !== void 0) {
      throw new Error("oidcConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function blobToMldev$3(fromObject) {
    const toObject = {};
    const fromData = getValueByPath(fromObject, ["data"]);
    if (fromData != null) {
      setValueByPath(toObject, ["data"], fromData);
    }
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function codeExecutionResultToVertex$3(fromObject) {
    const toObject = {};
    const fromOutcome = getValueByPath(fromObject, ["outcome"]);
    if (fromOutcome != null) {
      setValueByPath(toObject, ["outcome"], fromOutcome);
    }
    const fromOutput = getValueByPath(fromObject, ["output"]);
    if (fromOutput != null) {
      setValueByPath(toObject, ["output"], fromOutput);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function contentToMldev$3(fromObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToMldev$3(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function contentToVertex$3(fromObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToVertex$3(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function createCachedContentConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromTtl = getValueByPath(fromObject, ["ttl"]);
    if (parentObject !== void 0 && fromTtl != null) {
      setValueByPath(parentObject, ["ttl"], fromTtl);
    }
    const fromExpireTime = getValueByPath(fromObject, ["expireTime"]);
    if (parentObject !== void 0 && fromExpireTime != null) {
      setValueByPath(parentObject, ["expireTime"], fromExpireTime);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromDisplayName);
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (parentObject !== void 0 && fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToMldev$3(item);
        });
      }
      setValueByPath(parentObject, ["contents"], transformedList);
    }
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["systemInstruction"], contentToMldev$3(tContent(fromSystemInstruction)));
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = fromTools;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToMldev$3(item);
        });
      }
      setValueByPath(parentObject, ["tools"], transformedList);
    }
    const fromToolConfig = getValueByPath(fromObject, ["toolConfig"]);
    if (parentObject !== void 0 && fromToolConfig != null) {
      setValueByPath(parentObject, ["toolConfig"], toolConfigToMldev$1(fromToolConfig));
    }
    if (getValueByPath(fromObject, ["kmsKeyName"]) !== void 0) {
      throw new Error("kmsKeyName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function createCachedContentConfigToVertex(fromObject, parentObject) {
    const toObject = {};
    const fromTtl = getValueByPath(fromObject, ["ttl"]);
    if (parentObject !== void 0 && fromTtl != null) {
      setValueByPath(parentObject, ["ttl"], fromTtl);
    }
    const fromExpireTime = getValueByPath(fromObject, ["expireTime"]);
    if (parentObject !== void 0 && fromExpireTime != null) {
      setValueByPath(parentObject, ["expireTime"], fromExpireTime);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromDisplayName);
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (parentObject !== void 0 && fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToVertex$3(item);
        });
      }
      setValueByPath(parentObject, ["contents"], transformedList);
    }
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["systemInstruction"], contentToVertex$3(tContent(fromSystemInstruction)));
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = fromTools;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToVertex$2(item);
        });
      }
      setValueByPath(parentObject, ["tools"], transformedList);
    }
    const fromToolConfig = getValueByPath(fromObject, ["toolConfig"]);
    if (parentObject !== void 0 && fromToolConfig != null) {
      setValueByPath(parentObject, ["toolConfig"], toolConfigToVertex$1(fromToolConfig));
    }
    const fromKmsKeyName = getValueByPath(fromObject, ["kmsKeyName"]);
    if (parentObject !== void 0 && fromKmsKeyName != null) {
      setValueByPath(parentObject, ["encryption_spec", "kmsKeyName"], fromKmsKeyName);
    }
    return toObject;
  }
  function createCachedContentParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["model"], tCachesModel(apiClient, fromModel));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createCachedContentConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function createCachedContentParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["model"], tCachesModel(apiClient, fromModel));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createCachedContentConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function deleteCachedContentParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tCachedContentName(apiClient, fromName));
    }
    return toObject;
  }
  function deleteCachedContentParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tCachedContentName(apiClient, fromName));
    }
    return toObject;
  }
  function deleteCachedContentResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function deleteCachedContentResponseFromVertex(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function executableCodeToVertex$3(fromObject) {
    const toObject = {};
    const fromCode = getValueByPath(fromObject, ["code"]);
    if (fromCode != null) {
      setValueByPath(toObject, ["code"], fromCode);
    }
    const fromLanguage = getValueByPath(fromObject, ["language"]);
    if (fromLanguage != null) {
      setValueByPath(toObject, ["language"], fromLanguage);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function fileDataToMldev$3(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFileUri = getValueByPath(fromObject, ["fileUri"]);
    if (fromFileUri != null) {
      setValueByPath(toObject, ["fileUri"], fromFileUri);
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function functionCallToMldev$3(fromObject) {
    const toObject = {};
    const fromId = getValueByPath(fromObject, ["id"]);
    if (fromId != null) {
      setValueByPath(toObject, ["id"], fromId);
    }
    const fromArgs = getValueByPath(fromObject, ["args"]);
    if (fromArgs != null) {
      setValueByPath(toObject, ["args"], fromArgs);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    if (getValueByPath(fromObject, ["partialArgs"]) !== void 0) {
      throw new Error("partialArgs parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["willContinue"]) !== void 0) {
      throw new Error("willContinue parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function functionCallingConfigToMldev$1(fromObject) {
    const toObject = {};
    const fromAllowedFunctionNames = getValueByPath(fromObject, [
      "allowedFunctionNames"
    ]);
    if (fromAllowedFunctionNames != null) {
      setValueByPath(toObject, ["allowedFunctionNames"], fromAllowedFunctionNames);
    }
    const fromMode = getValueByPath(fromObject, ["mode"]);
    if (fromMode != null) {
      setValueByPath(toObject, ["mode"], fromMode);
    }
    if (getValueByPath(fromObject, ["streamFunctionCallArguments"]) !== void 0) {
      throw new Error("streamFunctionCallArguments parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function getCachedContentParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tCachedContentName(apiClient, fromName));
    }
    return toObject;
  }
  function getCachedContentParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tCachedContentName(apiClient, fromName));
    }
    return toObject;
  }
  function googleMapsToMldev$3(fromObject) {
    const toObject = {};
    const fromAuthConfig = getValueByPath(fromObject, ["authConfig"]);
    if (fromAuthConfig != null) {
      setValueByPath(toObject, ["authConfig"], authConfigToMldev$3(fromAuthConfig));
    }
    const fromEnableWidget = getValueByPath(fromObject, ["enableWidget"]);
    if (fromEnableWidget != null) {
      setValueByPath(toObject, ["enableWidget"], fromEnableWidget);
    }
    return toObject;
  }
  function googleSearchToMldev$3(fromObject) {
    const toObject = {};
    const fromSearchTypes = getValueByPath(fromObject, ["searchTypes"]);
    if (fromSearchTypes != null) {
      setValueByPath(toObject, ["searchTypes"], fromSearchTypes);
    }
    if (getValueByPath(fromObject, ["blockingConfidence"]) !== void 0) {
      throw new Error("blockingConfidence parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["excludeDomains"]) !== void 0) {
      throw new Error("excludeDomains parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromTimeRangeFilter = getValueByPath(fromObject, [
      "timeRangeFilter"
    ]);
    if (fromTimeRangeFilter != null) {
      setValueByPath(toObject, ["timeRangeFilter"], fromTimeRangeFilter);
    }
    return toObject;
  }
  function listCachedContentsConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    return toObject;
  }
  function listCachedContentsConfigToVertex(fromObject, parentObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    return toObject;
  }
  function listCachedContentsParametersToMldev(fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listCachedContentsConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function listCachedContentsParametersToVertex(fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listCachedContentsConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function listCachedContentsResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromCachedContents = getValueByPath(fromObject, [
      "cachedContents"
    ]);
    if (fromCachedContents != null) {
      let transformedList = fromCachedContents;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["cachedContents"], transformedList);
    }
    return toObject;
  }
  function listCachedContentsResponseFromVertex(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromCachedContents = getValueByPath(fromObject, [
      "cachedContents"
    ]);
    if (fromCachedContents != null) {
      let transformedList = fromCachedContents;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["cachedContents"], transformedList);
    }
    return toObject;
  }
  function mcpServerToVertex$2(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["name"]) !== void 0) {
      throw new Error("name parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["streamableHttpTransport"]) !== void 0) {
      throw new Error("streamableHttpTransport parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function partToMldev$3(fromObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], fromCodeExecutionResult);
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], fromExecutableCode);
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fileDataToMldev$3(fromFileData));
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], functionCallToMldev$3(fromFunctionCall));
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], blobToMldev$3(fromInlineData));
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    const fromToolCall = getValueByPath(fromObject, ["toolCall"]);
    if (fromToolCall != null) {
      setValueByPath(toObject, ["toolCall"], fromToolCall);
    }
    const fromToolResponse = getValueByPath(fromObject, ["toolResponse"]);
    if (fromToolResponse != null) {
      setValueByPath(toObject, ["toolResponse"], fromToolResponse);
    }
    const fromPartMetadata = getValueByPath(fromObject, ["partMetadata"]);
    if (fromPartMetadata != null) {
      setValueByPath(toObject, ["partMetadata"], fromPartMetadata);
    }
    return toObject;
  }
  function partToVertex$3(fromObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], codeExecutionResultToVertex$3(fromCodeExecutionResult));
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], executableCodeToVertex$3(fromExecutableCode));
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fromFileData);
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], fromFunctionCall);
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], fromInlineData);
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    if (getValueByPath(fromObject, ["toolCall"]) !== void 0) {
      throw new Error("toolCall parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["toolResponse"]) !== void 0) {
      throw new Error("toolResponse parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["partMetadata"]) !== void 0) {
      throw new Error("partMetadata parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function toolConfigToMldev$1(fromObject) {
    const toObject = {};
    const fromRetrievalConfig = getValueByPath(fromObject, [
      "retrievalConfig"
    ]);
    if (fromRetrievalConfig != null) {
      setValueByPath(toObject, ["retrievalConfig"], fromRetrievalConfig);
    }
    const fromFunctionCallingConfig = getValueByPath(fromObject, [
      "functionCallingConfig"
    ]);
    if (fromFunctionCallingConfig != null) {
      setValueByPath(toObject, ["functionCallingConfig"], functionCallingConfigToMldev$1(fromFunctionCallingConfig));
    }
    const fromIncludeServerSideToolInvocations = getValueByPath(fromObject, ["includeServerSideToolInvocations"]);
    if (fromIncludeServerSideToolInvocations != null) {
      setValueByPath(toObject, ["includeServerSideToolInvocations"], fromIncludeServerSideToolInvocations);
    }
    return toObject;
  }
  function toolConfigToVertex$1(fromObject) {
    const toObject = {};
    const fromRetrievalConfig = getValueByPath(fromObject, [
      "retrievalConfig"
    ]);
    if (fromRetrievalConfig != null) {
      setValueByPath(toObject, ["retrievalConfig"], fromRetrievalConfig);
    }
    const fromFunctionCallingConfig = getValueByPath(fromObject, [
      "functionCallingConfig"
    ]);
    if (fromFunctionCallingConfig != null) {
      setValueByPath(toObject, ["functionCallingConfig"], fromFunctionCallingConfig);
    }
    if (getValueByPath(fromObject, ["includeServerSideToolInvocations"]) !== void 0) {
      throw new Error("includeServerSideToolInvocations parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function toolToMldev$3(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["retrieval"]) !== void 0) {
      throw new Error("retrieval parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    const fromFileSearch = getValueByPath(fromObject, ["fileSearch"]);
    if (fromFileSearch != null) {
      setValueByPath(toObject, ["fileSearch"], fromFileSearch);
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], googleSearchToMldev$3(fromGoogleSearch));
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], googleMapsToMldev$3(fromGoogleMaps));
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    if (getValueByPath(fromObject, ["enterpriseWebSearch"]) !== void 0) {
      throw new Error("enterpriseWebSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    if (getValueByPath(fromObject, ["parallelAiSearch"]) !== void 0) {
      throw new Error("parallelAiSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function toolToVertex$2(fromObject) {
    const toObject = {};
    const fromRetrieval = getValueByPath(fromObject, ["retrieval"]);
    if (fromRetrieval != null) {
      setValueByPath(toObject, ["retrieval"], fromRetrieval);
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    if (getValueByPath(fromObject, ["fileSearch"]) !== void 0) {
      throw new Error("fileSearch parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], fromGoogleSearch);
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], fromGoogleMaps);
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    const fromEnterpriseWebSearch = getValueByPath(fromObject, [
      "enterpriseWebSearch"
    ]);
    if (fromEnterpriseWebSearch != null) {
      setValueByPath(toObject, ["enterpriseWebSearch"], fromEnterpriseWebSearch);
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    const fromParallelAiSearch = getValueByPath(fromObject, [
      "parallelAiSearch"
    ]);
    if (fromParallelAiSearch != null) {
      setValueByPath(toObject, ["parallelAiSearch"], fromParallelAiSearch);
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return mcpServerToVertex$2(item);
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function updateCachedContentConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromTtl = getValueByPath(fromObject, ["ttl"]);
    if (parentObject !== void 0 && fromTtl != null) {
      setValueByPath(parentObject, ["ttl"], fromTtl);
    }
    const fromExpireTime = getValueByPath(fromObject, ["expireTime"]);
    if (parentObject !== void 0 && fromExpireTime != null) {
      setValueByPath(parentObject, ["expireTime"], fromExpireTime);
    }
    return toObject;
  }
  function updateCachedContentConfigToVertex(fromObject, parentObject) {
    const toObject = {};
    const fromTtl = getValueByPath(fromObject, ["ttl"]);
    if (parentObject !== void 0 && fromTtl != null) {
      setValueByPath(parentObject, ["ttl"], fromTtl);
    }
    const fromExpireTime = getValueByPath(fromObject, ["expireTime"]);
    if (parentObject !== void 0 && fromExpireTime != null) {
      setValueByPath(parentObject, ["expireTime"], fromExpireTime);
    }
    return toObject;
  }
  function updateCachedContentParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tCachedContentName(apiClient, fromName));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      updateCachedContentConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function updateCachedContentParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], tCachedContentName(apiClient, fromName));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      updateCachedContentConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  var Caches = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
      this.list = async (params = {}) => {
        return new Pager(PagedItem.PAGED_ITEM_CACHED_CONTENTS, (x) => this.listInternal(x), await this.listInternal(params), params);
      };
    }
    /**
     * Creates a cached contents resource.
     *
     * @remarks
     * Context caching is only supported for specific models. See [Gemini
     * Developer API reference](https://ai.google.dev/gemini-api/docs/caching?lang=node/context-cac)
     * and [Gemini Enterprise Agent Platform reference](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview#supported_models)
     * for more information.
     *
     * @param params - The parameters for the create request.
     * @return The created cached content.
     *
     * @example
     * ```ts
     * const contents = ...; // Initialize the content to cache.
     * const response = await ai.caches.create({
     *   model: 'gemini-2.0-flash-001',
     *   config: {
     *    'contents': contents,
     *    'displayName': 'test cache',
     *    'systemInstruction': 'What is the sum of the two pdfs?',
     *    'ttl': '86400s',
     *  }
     * });
     * ```
     */
    async create(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = createCachedContentParametersToVertex(this.apiClient, params);
        path = formatMap("cachedContents", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      } else {
        const body = createCachedContentParametersToMldev(this.apiClient, params);
        path = formatMap("cachedContents", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
    /**
     * Gets cached content configurations.
     *
     * @param params - The parameters for the get request.
     * @return The cached content.
     *
     * @example
     * ```ts
     * await ai.caches.get({name: '...'}); // The server-generated resource name.
     * ```
     */
    async get(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = getCachedContentParametersToVertex(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      } else {
        const body = getCachedContentParametersToMldev(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
    /**
     * Deletes cached content.
     *
     * @param params - The parameters for the delete request.
     * @return The empty response returned by the API.
     *
     * @example
     * ```ts
     * await ai.caches.delete({name: '...'}); // The server-generated resource name.
     * ```
     */
    async delete(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = deleteCachedContentParametersToVertex(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = deleteCachedContentResponseFromVertex(apiResponse);
          const typedResp = new DeleteCachedContentResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = deleteCachedContentParametersToMldev(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = deleteCachedContentResponseFromMldev(apiResponse);
          const typedResp = new DeleteCachedContentResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Updates cached content configurations.
     *
     * @param params - The parameters for the update request.
     * @return The updated cached content.
     *
     * @example
     * ```ts
     * const response = await ai.caches.update({
     *   name: '...',  // The server-generated resource name.
     *   config: {'ttl': '7600s'}
     * });
     * ```
     */
    async update(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = updateCachedContentParametersToVertex(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "PATCH",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      } else {
        const body = updateCachedContentParametersToMldev(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "PATCH",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
    async listInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = listCachedContentsParametersToVertex(params);
        path = formatMap("cachedContents", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listCachedContentsResponseFromVertex(apiResponse);
          const typedResp = new ListCachedContentsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = listCachedContentsParametersToMldev(params);
        path = formatMap("cachedContents", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listCachedContentsResponseFromMldev(apiResponse);
          const typedResp = new ListCachedContentsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
  };
  function __rest(s, e) {
    var t2 = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
      t2[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
        if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
          t2[p[i]] = s[p[i]];
      }
    return t2;
  }
  function __values(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
      next: function() {
        if (o && i >= o.length) o = void 0;
        return { value: o && o[i++], done: !o };
      }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
  }
  function __await(v) {
    return this instanceof __await ? (this.v = v, this) : new __await(v);
  }
  function __asyncGenerator(thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function() {
      return this;
    }, i;
    function awaitReturn(f) {
      return function(v) {
        return Promise.resolve(v).then(f, reject);
      };
    }
    function verb(n, f) {
      if (g[n]) {
        i[n] = function(v) {
          return new Promise(function(a, b) {
            q.push([n, v, a, b]) > 1 || resume(n, v);
          });
        };
        if (f) i[n] = f(i[n]);
      }
    }
    function resume(n, v) {
      try {
        step(g[n](v));
      } catch (e) {
        settle(q[0][3], e);
      }
    }
    function step(r) {
      r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);
    }
    function fulfill(value) {
      resume("next", value);
    }
    function reject(value) {
      resume("throw", value);
    }
    function settle(f, v) {
      if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]);
    }
  }
  function __asyncValues(o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function() {
      return this;
    }, i);
    function verb(n) {
      i[n] = o[n] && function(v) {
        return new Promise(function(resolve, reject) {
          v = o[n](v), settle(resolve, reject, v.done, v.value);
        });
      };
    }
    function settle(resolve, reject, d, v) {
      Promise.resolve(v).then(function(v2) {
        resolve({ value: v2, done: d });
      }, reject);
    }
  }
  function isValidResponse(response) {
    var _a2;
    if (response.candidates == void 0 || response.candidates.length === 0) {
      return false;
    }
    const content = (_a2 = response.candidates[0]) === null || _a2 === void 0 ? void 0 : _a2.content;
    if (content === void 0) {
      return false;
    }
    return isValidContent(content);
  }
  function isValidContent(content) {
    if (content.parts === void 0 || content.parts.length === 0) {
      return false;
    }
    for (const part of content.parts) {
      if (part === void 0 || Object.keys(part).length === 0) {
        return false;
      }
    }
    return true;
  }
  function validateHistory(history) {
    if (history.length === 0) {
      return;
    }
    for (const content of history) {
      if (content.role !== "user" && content.role !== "model") {
        throw new Error(`Role must be user or model, but got ${content.role}.`);
      }
    }
  }
  function extractCuratedHistory(comprehensiveHistory) {
    if (comprehensiveHistory === void 0 || comprehensiveHistory.length === 0) {
      return [];
    }
    const curatedHistory = [];
    const length = comprehensiveHistory.length;
    let i = 0;
    while (i < length) {
      if (comprehensiveHistory[i].role === "user") {
        curatedHistory.push(comprehensiveHistory[i]);
        i++;
      } else {
        const modelOutput = [];
        let isValid = true;
        while (i < length && comprehensiveHistory[i].role === "model") {
          modelOutput.push(comprehensiveHistory[i]);
          if (isValid && !isValidContent(comprehensiveHistory[i])) {
            isValid = false;
          }
          i++;
        }
        if (isValid) {
          curatedHistory.push(...modelOutput);
        } else {
          curatedHistory.pop();
        }
      }
    }
    return curatedHistory;
  }
  var Chats = class {
    constructor(modelsModule, apiClient) {
      this.modelsModule = modelsModule;
      this.apiClient = apiClient;
    }
    /**
     * Creates a new chat session.
     *
     * @remarks
     * The config in the params will be used for all requests within the chat
     * session unless overridden by a per-request `config` in
     * @see {@link types.SendMessageParameters#config}.
     *
     * @param params - Parameters for creating a chat session.
     * @returns A new chat session.
     *
     * @example
     * ```ts
     * const chat = ai.chats.create({
     *   model: 'gemini-2.0-flash'
     *   config: {
     *     temperature: 0.5,
     *     maxOutputTokens: 1024,
     *   }
     * });
     * ```
     */
    create(params) {
      return new Chat(
        this.apiClient,
        this.modelsModule,
        params.model,
        params.config,
        // Deep copy the history to avoid mutating the history outside of the
        // chat session.
        structuredClone(params.history)
      );
    }
  };
  var Chat = class {
    constructor(apiClient, modelsModule, model, config = {}, history = []) {
      this.apiClient = apiClient;
      this.modelsModule = modelsModule;
      this.model = model;
      this.config = config;
      this.history = history;
      this.sendPromise = Promise.resolve();
      validateHistory(history);
    }
    /**
     * Sends a message to the model and returns the response.
     *
     * @remarks
     * This method will wait for the previous message to be processed before
     * sending the next message.
     *
     * @see {@link Chat#sendMessageStream} for streaming method.
     * @param params - parameters for sending messages within a chat session.
     * @returns The model's response.
     *
     * @example
     * ```ts
     * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
     * const response = await chat.sendMessage({
     *   message: 'Why is the sky blue?'
     * });
     * console.log(response.text);
     * ```
     */
    async sendMessage(params) {
      var _a2;
      await this.sendPromise;
      const inputContent = tContent(params.message);
      const responsePromise = this.modelsModule.generateContent({
        model: this.model,
        contents: this.getHistory(true).concat(inputContent),
        config: (_a2 = params.config) !== null && _a2 !== void 0 ? _a2 : this.config
      });
      this.sendPromise = (async () => {
        var _a3, _b, _c;
        const response = await responsePromise;
        const outputContent = (_b = (_a3 = response.candidates) === null || _a3 === void 0 ? void 0 : _a3[0]) === null || _b === void 0 ? void 0 : _b.content;
        const fullAutomaticFunctionCallingHistory = response.automaticFunctionCallingHistory;
        const index = this.getHistory(true).length;
        let automaticFunctionCallingHistory = [];
        if (fullAutomaticFunctionCallingHistory != null) {
          automaticFunctionCallingHistory = (_c = fullAutomaticFunctionCallingHistory.slice(index)) !== null && _c !== void 0 ? _c : [];
        }
        const modelOutput = outputContent ? [outputContent] : [];
        this.recordHistory(inputContent, modelOutput, automaticFunctionCallingHistory);
        return;
      })();
      await this.sendPromise.catch(() => {
        this.sendPromise = Promise.resolve();
      });
      return responsePromise;
    }
    /**
     * Sends a message to the model and returns the response in chunks.
     *
     * @remarks
     * This method will wait for the previous message to be processed before
     * sending the next message.
     *
     * @see {@link Chat#sendMessage} for non-streaming method.
     * @param params - parameters for sending the message.
     * @return The model's response.
     *
     * @example
     * ```ts
     * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
     * const response = await chat.sendMessageStream({
     *   message: 'Why is the sky blue?'
     * });
     * for await (const chunk of response) {
     *   console.log(chunk.text);
     * }
     * ```
     */
    async sendMessageStream(params) {
      var _a2;
      await this.sendPromise;
      const inputContent = tContent(params.message);
      const streamResponse = this.modelsModule.generateContentStream({
        model: this.model,
        contents: this.getHistory(true).concat(inputContent),
        config: (_a2 = params.config) !== null && _a2 !== void 0 ? _a2 : this.config
      });
      this.sendPromise = streamResponse.then(() => void 0).catch(() => void 0);
      const response = await streamResponse;
      const result = this.processStreamResponse(response, inputContent);
      return result;
    }
    /**
     * Returns the chat history.
     *
     * @remarks
     * The history is a list of contents alternating between user and model.
     *
     * There are two types of history:
     * - The `curated history` contains only the valid turns between user and
     * model, which will be included in the subsequent requests sent to the model.
     * - The `comprehensive history` contains all turns, including invalid or
     *   empty model outputs, providing a complete record of the history.
     *
     * The history is updated after receiving the response from the model,
     * for streaming response, it means receiving the last chunk of the response.
     *
     * The `comprehensive history` is returned by default. To get the `curated
     * history`, set the `curated` parameter to `true`.
     *
     * @param curated - whether to return the curated history or the comprehensive
     *     history.
     * @return History contents alternating between user and model for the entire
     *     chat session.
     */
    getHistory(curated = false) {
      const history = curated ? extractCuratedHistory(this.history) : this.history;
      return structuredClone(history);
    }
    processStreamResponse(streamResponse, inputContent) {
      return __asyncGenerator(this, arguments, function* processStreamResponse_1() {
        var _a2, e_1, _b, _c;
        var _d, _e;
        const outputContent = [];
        try {
          for (var _f = true, streamResponse_1 = __asyncValues(streamResponse), streamResponse_1_1; streamResponse_1_1 = yield __await(streamResponse_1.next()), _a2 = streamResponse_1_1.done, !_a2; _f = true) {
            _c = streamResponse_1_1.value;
            _f = false;
            const chunk = _c;
            if (isValidResponse(chunk)) {
              const content = (_e = (_d = chunk.candidates) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.content;
              if (content !== void 0) {
                outputContent.push(content);
              }
            }
            yield yield __await(chunk);
          }
        } catch (e_1_1) {
          e_1 = { error: e_1_1 };
        } finally {
          try {
            if (!_f && !_a2 && (_b = streamResponse_1.return)) yield __await(_b.call(streamResponse_1));
          } finally {
            if (e_1) throw e_1.error;
          }
        }
        this.recordHistory(inputContent, outputContent);
      });
    }
    recordHistory(userInput, modelOutput, automaticFunctionCallingHistory) {
      let outputContents = [];
      if (modelOutput.length > 0 && modelOutput.every((content) => content.role !== void 0)) {
        outputContents = modelOutput;
      } else {
        outputContents.push({
          role: "model",
          parts: []
        });
      }
      if (automaticFunctionCallingHistory && automaticFunctionCallingHistory.length > 0) {
        this.history.push(...extractCuratedHistory(automaticFunctionCallingHistory));
      } else {
        this.history.push(userInput);
      }
      this.history.push(...outputContents);
    }
  };
  var ApiError = class _ApiError extends Error {
    constructor(options) {
      super(options.message);
      this.name = "ApiError";
      this.status = options.status;
      Object.setPrototypeOf(this, _ApiError.prototype);
    }
  };
  function createFileParametersToMldev(fromObject) {
    const toObject = {};
    const fromFile = getValueByPath(fromObject, ["file"]);
    if (fromFile != null) {
      setValueByPath(toObject, ["file"], fromFile);
    }
    return toObject;
  }
  function createFileResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function deleteFileParametersToMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "file"], tFileName(fromName));
    }
    return toObject;
  }
  function deleteFileResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function getFileParametersToMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "file"], tFileName(fromName));
    }
    return toObject;
  }
  function internalRegisterFilesParametersToMldev(fromObject) {
    const toObject = {};
    const fromUris = getValueByPath(fromObject, ["uris"]);
    if (fromUris != null) {
      setValueByPath(toObject, ["uris"], fromUris);
    }
    return toObject;
  }
  function listFilesConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    return toObject;
  }
  function listFilesParametersToMldev(fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listFilesConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function listFilesResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromFiles = getValueByPath(fromObject, ["files"]);
    if (fromFiles != null) {
      let transformedList = fromFiles;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["files"], transformedList);
    }
    return toObject;
  }
  function registerFilesResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromFiles = getValueByPath(fromObject, ["files"]);
    if (fromFiles != null) {
      let transformedList = fromFiles;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["files"], transformedList);
    }
    return toObject;
  }
  var Files = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
      this.list = async (params = {}) => {
        return new Pager(PagedItem.PAGED_ITEM_FILES, (x) => this.listInternal(x), await this.listInternal(params), params);
      };
    }
    /**
     * Uploads a file asynchronously to the Gemini API.
     * This method is not available in Gemini Enterprise Agent Platform (previously known as Vertex AI).
     * Supported upload sources:
     * - Node.js: File path (string) or Blob object.
     * - Browser: Blob object (e.g., File).
     *
     * @remarks
     * The `mimeType` can be specified in the `config` parameter. If omitted:
     *  - For file path (string) inputs, the `mimeType` will be inferred from the
     *     file extension.
     *  - For Blob object inputs, the `mimeType` will be set to the Blob's `type`
     *     property.
     * Somex eamples for file extension to mimeType mapping:
     * .txt -> text/plain
     * .json -> application/json
     * .jpg  -> image/jpeg
     * .png -> image/png
     * .mp3 -> audio/mpeg
     * .mp4 -> video/mp4
     *
     * This section can contain multiple paragraphs and code examples.
     *
     * @param params - Optional parameters specified in the
     *        `types.UploadFileParameters` interface.
     *         @see {@link types.UploadFileParameters#config} for the optional
     *         config in the parameters.
     * @return A promise that resolves to a `types.File` object.
     * @throws An error if called on a Gemini Enterprise Agent Platform (previously known as Vertex AI) client.
     * @throws An error if the `mimeType` is not provided and can not be inferred,
     * the `mimeType` can be provided in the `params.config` parameter.
     * @throws An error occurs if a suitable upload location cannot be established.
     *
     * @example
     * The following code uploads a file to Gemini API.
     *
     * ```ts
     * const file = await ai.files.upload({file: 'file.txt', config: {
     *   mimeType: 'text/plain',
     * }});
     * console.log(file.name);
     * ```
     */
    async upload(params) {
      if (this.apiClient.isVertexAI()) {
        throw new Error("Gemini Enterprise Agent Platform (previously known as Vertex AI) does not support uploading files. You can share files through a GCS bucket.");
      }
      return this.apiClient.uploadFile(params.file, params.config).then((resp) => {
        return resp;
      });
    }
    /**
     * Downloads a remotely stored file asynchronously to a location specified in
     * the `params` object. This method only works on Node environment, to
     * download files in the browser, use a browser compliant method like an <a>
     * tag.
     *
     * @param params - The parameters for the download request.
     *
     * @example
     * The following code downloads an example file named "files/mehozpxf877d" as
     * "file.txt".
     *
     * ```ts
     * await ai.files.download({file: file.name, downloadPath: 'file.txt'});
     * ```
     */
    async download(params) {
      await this.apiClient.downloadFile(params);
    }
    /**
     * Registers Google Cloud Storage files for use with the API.
     * This method is only available in Node.js environments.
     */
    async registerFiles(params) {
      throw new Error("registerFiles is only supported in Node.js environments.");
    }
    async _registerFiles(params) {
      return this.registerFilesInternal(params);
    }
    async listInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = listFilesParametersToMldev(params);
        path = formatMap("files", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listFilesResponseFromMldev(apiResponse);
          const typedResp = new ListFilesResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    async createInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = createFileParametersToMldev(params);
        path = formatMap("upload/v1beta/files", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = createFileResponseFromMldev(apiResponse);
          const typedResp = new CreateFileResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Retrieves the file information from the service.
     *
     * @param params - The parameters for the get request
     * @return The Promise that resolves to the types.File object requested.
     *
     * @example
     * ```ts
     * const config: GetFileParameters = {
     *   name: fileName,
     * };
     * file = await ai.files.get(config);
     * console.log(file.name);
     * ```
     */
    async get(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = getFileParametersToMldev(params);
        path = formatMap("files/{file}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
    /**
     * Deletes a remotely stored file.
     *
     * @param params - The parameters for the delete request.
     * @return The DeleteFileResponse, the response for the delete method.
     *
     * @example
     * The following code deletes an example file named "files/mehozpxf877d".
     *
     * ```ts
     * await ai.files.delete({name: file.name});
     * ```
     */
    async delete(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = deleteFileParametersToMldev(params);
        path = formatMap("files/{file}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = deleteFileResponseFromMldev(apiResponse);
          const typedResp = new DeleteFileResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    async registerFilesInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = internalRegisterFilesParametersToMldev(params);
        path = formatMap("files:register", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = registerFilesResponseFromMldev(apiResponse);
          const typedResp = new RegisterFilesResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
  };
  function audioTranscriptionConfigToMldev$1(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["languageCodes"]) !== void 0) {
      throw new Error("languageCodes parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromLanguageAuto = getValueByPath(fromObject, ["languageAuto"]);
    if (fromLanguageAuto != null) {
      setValueByPath(toObject, ["languageAuto"], fromLanguageAuto);
    }
    const fromLanguageHints = getValueByPath(fromObject, [
      "languageHints"
    ]);
    if (fromLanguageHints != null) {
      setValueByPath(toObject, ["languageHints"], fromLanguageHints);
    }
    const fromAdaptationPhrases = getValueByPath(fromObject, [
      "adaptationPhrases"
    ]);
    if (fromAdaptationPhrases != null) {
      setValueByPath(toObject, ["adaptationPhrases"], fromAdaptationPhrases);
    }
    return toObject;
  }
  function authConfigToMldev$2(fromObject) {
    const toObject = {};
    const fromApiKey = getValueByPath(fromObject, ["apiKey"]);
    if (fromApiKey != null) {
      setValueByPath(toObject, ["apiKey"], fromApiKey);
    }
    if (getValueByPath(fromObject, ["apiKeyConfig"]) !== void 0) {
      throw new Error("apiKeyConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["authType"]) !== void 0) {
      throw new Error("authType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["googleServiceAccountConfig"]) !== void 0) {
      throw new Error("googleServiceAccountConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["httpBasicAuthConfig"]) !== void 0) {
      throw new Error("httpBasicAuthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oauthConfig"]) !== void 0) {
      throw new Error("oauthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oidcConfig"]) !== void 0) {
      throw new Error("oidcConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function blobToMldev$2(fromObject) {
    const toObject = {};
    const fromData = getValueByPath(fromObject, ["data"]);
    if (fromData != null) {
      setValueByPath(toObject, ["data"], fromData);
    }
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function codeExecutionResultToVertex$2(fromObject) {
    const toObject = {};
    const fromOutcome = getValueByPath(fromObject, ["outcome"]);
    if (fromOutcome != null) {
      setValueByPath(toObject, ["outcome"], fromOutcome);
    }
    const fromOutput = getValueByPath(fromObject, ["output"]);
    if (fromOutput != null) {
      setValueByPath(toObject, ["output"], fromOutput);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function contentToMldev$2(fromObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToMldev$2(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function contentToVertex$2(fromObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToVertex$2(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function executableCodeToVertex$2(fromObject) {
    const toObject = {};
    const fromCode = getValueByPath(fromObject, ["code"]);
    if (fromCode != null) {
      setValueByPath(toObject, ["code"], fromCode);
    }
    const fromLanguage = getValueByPath(fromObject, ["language"]);
    if (fromLanguage != null) {
      setValueByPath(toObject, ["language"], fromLanguage);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function fileDataToMldev$2(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFileUri = getValueByPath(fromObject, ["fileUri"]);
    if (fromFileUri != null) {
      setValueByPath(toObject, ["fileUri"], fromFileUri);
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function functionCallToMldev$2(fromObject) {
    const toObject = {};
    const fromId = getValueByPath(fromObject, ["id"]);
    if (fromId != null) {
      setValueByPath(toObject, ["id"], fromId);
    }
    const fromArgs = getValueByPath(fromObject, ["args"]);
    if (fromArgs != null) {
      setValueByPath(toObject, ["args"], fromArgs);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    if (getValueByPath(fromObject, ["partialArgs"]) !== void 0) {
      throw new Error("partialArgs parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["willContinue"]) !== void 0) {
      throw new Error("willContinue parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function generationConfigToVertex$1(fromObject) {
    const toObject = {};
    const fromModelSelectionConfig = getValueByPath(fromObject, [
      "modelSelectionConfig"
    ]);
    if (fromModelSelectionConfig != null) {
      setValueByPath(toObject, ["modelConfig"], fromModelSelectionConfig);
    }
    const fromResponseJsonSchema = getValueByPath(fromObject, [
      "responseJsonSchema"
    ]);
    if (fromResponseJsonSchema != null) {
      setValueByPath(toObject, ["responseJsonSchema"], fromResponseJsonSchema);
    }
    const fromAudioTimestamp = getValueByPath(fromObject, [
      "audioTimestamp"
    ]);
    if (fromAudioTimestamp != null) {
      setValueByPath(toObject, ["audioTimestamp"], fromAudioTimestamp);
    }
    const fromCandidateCount = getValueByPath(fromObject, [
      "candidateCount"
    ]);
    if (fromCandidateCount != null) {
      setValueByPath(toObject, ["candidateCount"], fromCandidateCount);
    }
    const fromEnableAffectiveDialog = getValueByPath(fromObject, [
      "enableAffectiveDialog"
    ]);
    if (fromEnableAffectiveDialog != null) {
      setValueByPath(toObject, ["enableAffectiveDialog"], fromEnableAffectiveDialog);
    }
    const fromFrequencyPenalty = getValueByPath(fromObject, [
      "frequencyPenalty"
    ]);
    if (fromFrequencyPenalty != null) {
      setValueByPath(toObject, ["frequencyPenalty"], fromFrequencyPenalty);
    }
    const fromLogprobs = getValueByPath(fromObject, ["logprobs"]);
    if (fromLogprobs != null) {
      setValueByPath(toObject, ["logprobs"], fromLogprobs);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (fromMaxOutputTokens != null) {
      setValueByPath(toObject, ["maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromPresencePenalty = getValueByPath(fromObject, [
      "presencePenalty"
    ]);
    if (fromPresencePenalty != null) {
      setValueByPath(toObject, ["presencePenalty"], fromPresencePenalty);
    }
    const fromResponseLogprobs = getValueByPath(fromObject, [
      "responseLogprobs"
    ]);
    if (fromResponseLogprobs != null) {
      setValueByPath(toObject, ["responseLogprobs"], fromResponseLogprobs);
    }
    const fromResponseMimeType = getValueByPath(fromObject, [
      "responseMimeType"
    ]);
    if (fromResponseMimeType != null) {
      setValueByPath(toObject, ["responseMimeType"], fromResponseMimeType);
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (fromResponseModalities != null) {
      setValueByPath(toObject, ["responseModalities"], fromResponseModalities);
    }
    const fromResponseSchema = getValueByPath(fromObject, [
      "responseSchema"
    ]);
    if (fromResponseSchema != null) {
      setValueByPath(toObject, ["responseSchema"], fromResponseSchema);
    }
    const fromRoutingConfig = getValueByPath(fromObject, [
      "routingConfig"
    ]);
    if (fromRoutingConfig != null) {
      setValueByPath(toObject, ["routingConfig"], fromRoutingConfig);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (fromSeed != null) {
      setValueByPath(toObject, ["seed"], fromSeed);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (fromSpeechConfig != null) {
      setValueByPath(toObject, ["speechConfig"], fromSpeechConfig);
    }
    const fromStopSequences = getValueByPath(fromObject, [
      "stopSequences"
    ]);
    if (fromStopSequences != null) {
      setValueByPath(toObject, ["stopSequences"], fromStopSequences);
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (fromTemperature != null) {
      setValueByPath(toObject, ["temperature"], fromTemperature);
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (fromThinkingConfig != null) {
      setValueByPath(toObject, ["thinkingConfig"], fromThinkingConfig);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (fromTopK != null) {
      setValueByPath(toObject, ["topK"], fromTopK);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (fromTopP != null) {
      setValueByPath(toObject, ["topP"], fromTopP);
    }
    if (getValueByPath(fromObject, ["enableEnhancedCivicAnswers"]) !== void 0) {
      throw new Error("enableEnhancedCivicAnswers parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function googleMapsToMldev$2(fromObject) {
    const toObject = {};
    const fromAuthConfig = getValueByPath(fromObject, ["authConfig"]);
    if (fromAuthConfig != null) {
      setValueByPath(toObject, ["authConfig"], authConfigToMldev$2(fromAuthConfig));
    }
    const fromEnableWidget = getValueByPath(fromObject, ["enableWidget"]);
    if (fromEnableWidget != null) {
      setValueByPath(toObject, ["enableWidget"], fromEnableWidget);
    }
    return toObject;
  }
  function googleSearchToMldev$2(fromObject) {
    const toObject = {};
    const fromSearchTypes = getValueByPath(fromObject, ["searchTypes"]);
    if (fromSearchTypes != null) {
      setValueByPath(toObject, ["searchTypes"], fromSearchTypes);
    }
    if (getValueByPath(fromObject, ["blockingConfidence"]) !== void 0) {
      throw new Error("blockingConfidence parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["excludeDomains"]) !== void 0) {
      throw new Error("excludeDomains parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromTimeRangeFilter = getValueByPath(fromObject, [
      "timeRangeFilter"
    ]);
    if (fromTimeRangeFilter != null) {
      setValueByPath(toObject, ["timeRangeFilter"], fromTimeRangeFilter);
    }
    return toObject;
  }
  function liveConnectConfigToMldev$1(fromObject, parentObject) {
    const toObject = {};
    const fromGenerationConfig = getValueByPath(fromObject, [
      "generationConfig"
    ]);
    if (parentObject !== void 0 && fromGenerationConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig"], fromGenerationConfig);
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (parentObject !== void 0 && fromResponseModalities != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "responseModalities"], fromResponseModalities);
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (parentObject !== void 0 && fromTemperature != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "temperature"], fromTemperature);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (parentObject !== void 0 && fromTopP != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "topP"], fromTopP);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (parentObject !== void 0 && fromTopK != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "topK"], fromTopK);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (parentObject !== void 0 && fromMaxOutputTokens != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (parentObject !== void 0 && fromMediaResolution != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "mediaResolution"], fromMediaResolution);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (parentObject !== void 0 && fromSeed != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "seed"], fromSeed);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (parentObject !== void 0 && fromSpeechConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "speechConfig"], tLiveSpeechConfig(fromSpeechConfig));
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (parentObject !== void 0 && fromThinkingConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "thinkingConfig"], fromThinkingConfig);
    }
    const fromEnableAffectiveDialog = getValueByPath(fromObject, [
      "enableAffectiveDialog"
    ]);
    if (parentObject !== void 0 && fromEnableAffectiveDialog != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "enableAffectiveDialog"], fromEnableAffectiveDialog);
    }
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["setup", "systemInstruction"], contentToMldev$2(tContent(fromSystemInstruction)));
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = tTools(fromTools);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToMldev$2(tTool(item));
        });
      }
      setValueByPath(parentObject, ["setup", "tools"], transformedList);
    }
    const fromSessionResumption = getValueByPath(fromObject, [
      "sessionResumption"
    ]);
    if (parentObject !== void 0 && fromSessionResumption != null) {
      setValueByPath(parentObject, ["setup", "sessionResumption"], sessionResumptionConfigToMldev$1(fromSessionResumption));
    }
    const fromInputAudioTranscription = getValueByPath(fromObject, [
      "inputAudioTranscription"
    ]);
    if (parentObject !== void 0 && fromInputAudioTranscription != null) {
      setValueByPath(parentObject, ["setup", "inputAudioTranscription"], audioTranscriptionConfigToMldev$1(fromInputAudioTranscription));
    }
    const fromOutputAudioTranscription = getValueByPath(fromObject, [
      "outputAudioTranscription"
    ]);
    if (parentObject !== void 0 && fromOutputAudioTranscription != null) {
      setValueByPath(parentObject, ["setup", "outputAudioTranscription"], audioTranscriptionConfigToMldev$1(fromOutputAudioTranscription));
    }
    const fromRealtimeInputConfig = getValueByPath(fromObject, [
      "realtimeInputConfig"
    ]);
    if (parentObject !== void 0 && fromRealtimeInputConfig != null) {
      setValueByPath(parentObject, ["setup", "realtimeInputConfig"], fromRealtimeInputConfig);
    }
    const fromContextWindowCompression = getValueByPath(fromObject, [
      "contextWindowCompression"
    ]);
    if (parentObject !== void 0 && fromContextWindowCompression != null) {
      setValueByPath(parentObject, ["setup", "contextWindowCompression"], fromContextWindowCompression);
    }
    const fromProactivity = getValueByPath(fromObject, ["proactivity"]);
    if (parentObject !== void 0 && fromProactivity != null) {
      setValueByPath(parentObject, ["setup", "proactivity"], fromProactivity);
    }
    if (getValueByPath(fromObject, ["explicitVadSignal"]) !== void 0) {
      throw new Error("explicitVadSignal parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromAvatarConfig = getValueByPath(fromObject, ["avatarConfig"]);
    if (parentObject !== void 0 && fromAvatarConfig != null) {
      setValueByPath(parentObject, ["setup", "avatarConfig"], fromAvatarConfig);
    }
    const fromSafetySettings = getValueByPath(fromObject, [
      "safetySettings"
    ]);
    if (parentObject !== void 0 && fromSafetySettings != null) {
      let transformedList = fromSafetySettings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return safetySettingToMldev$2(item);
        });
      }
      setValueByPath(parentObject, ["setup", "safetySettings"], transformedList);
    }
    const fromTranslationConfig = getValueByPath(fromObject, [
      "translationConfig"
    ]);
    if (parentObject !== void 0 && fromTranslationConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "translationConfig"], fromTranslationConfig);
    }
    return toObject;
  }
  function liveConnectConfigToVertex(fromObject, parentObject) {
    const toObject = {};
    const fromGenerationConfig = getValueByPath(fromObject, [
      "generationConfig"
    ]);
    if (parentObject !== void 0 && fromGenerationConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig"], generationConfigToVertex$1(fromGenerationConfig));
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (parentObject !== void 0 && fromResponseModalities != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "responseModalities"], fromResponseModalities);
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (parentObject !== void 0 && fromTemperature != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "temperature"], fromTemperature);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (parentObject !== void 0 && fromTopP != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "topP"], fromTopP);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (parentObject !== void 0 && fromTopK != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "topK"], fromTopK);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (parentObject !== void 0 && fromMaxOutputTokens != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (parentObject !== void 0 && fromMediaResolution != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "mediaResolution"], fromMediaResolution);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (parentObject !== void 0 && fromSeed != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "seed"], fromSeed);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (parentObject !== void 0 && fromSpeechConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "speechConfig"], tLiveSpeechConfig(fromSpeechConfig));
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (parentObject !== void 0 && fromThinkingConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "thinkingConfig"], fromThinkingConfig);
    }
    const fromEnableAffectiveDialog = getValueByPath(fromObject, [
      "enableAffectiveDialog"
    ]);
    if (parentObject !== void 0 && fromEnableAffectiveDialog != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "enableAffectiveDialog"], fromEnableAffectiveDialog);
    }
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["setup", "systemInstruction"], contentToVertex$2(tContent(fromSystemInstruction)));
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = tTools(fromTools);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToVertex$1(tTool(item));
        });
      }
      setValueByPath(parentObject, ["setup", "tools"], transformedList);
    }
    const fromSessionResumption = getValueByPath(fromObject, [
      "sessionResumption"
    ]);
    if (parentObject !== void 0 && fromSessionResumption != null) {
      setValueByPath(parentObject, ["setup", "sessionResumption"], fromSessionResumption);
    }
    const fromInputAudioTranscription = getValueByPath(fromObject, [
      "inputAudioTranscription"
    ]);
    if (parentObject !== void 0 && fromInputAudioTranscription != null) {
      setValueByPath(parentObject, ["setup", "inputAudioTranscription"], fromInputAudioTranscription);
    }
    const fromOutputAudioTranscription = getValueByPath(fromObject, [
      "outputAudioTranscription"
    ]);
    if (parentObject !== void 0 && fromOutputAudioTranscription != null) {
      setValueByPath(parentObject, ["setup", "outputAudioTranscription"], fromOutputAudioTranscription);
    }
    const fromRealtimeInputConfig = getValueByPath(fromObject, [
      "realtimeInputConfig"
    ]);
    if (parentObject !== void 0 && fromRealtimeInputConfig != null) {
      setValueByPath(parentObject, ["setup", "realtimeInputConfig"], fromRealtimeInputConfig);
    }
    const fromContextWindowCompression = getValueByPath(fromObject, [
      "contextWindowCompression"
    ]);
    if (parentObject !== void 0 && fromContextWindowCompression != null) {
      setValueByPath(parentObject, ["setup", "contextWindowCompression"], fromContextWindowCompression);
    }
    const fromProactivity = getValueByPath(fromObject, ["proactivity"]);
    if (parentObject !== void 0 && fromProactivity != null) {
      setValueByPath(parentObject, ["setup", "proactivity"], fromProactivity);
    }
    const fromExplicitVadSignal = getValueByPath(fromObject, [
      "explicitVadSignal"
    ]);
    if (parentObject !== void 0 && fromExplicitVadSignal != null) {
      setValueByPath(parentObject, ["setup", "explicitVadSignal"], fromExplicitVadSignal);
    }
    const fromAvatarConfig = getValueByPath(fromObject, ["avatarConfig"]);
    if (parentObject !== void 0 && fromAvatarConfig != null) {
      setValueByPath(parentObject, ["setup", "avatarConfig"], fromAvatarConfig);
    }
    const fromSafetySettings = getValueByPath(fromObject, [
      "safetySettings"
    ]);
    if (parentObject !== void 0 && fromSafetySettings != null) {
      let transformedList = fromSafetySettings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(parentObject, ["setup", "safetySettings"], transformedList);
    }
    if (getValueByPath(fromObject, ["translationConfig"]) !== void 0) {
      throw new Error("translationConfig parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function liveConnectParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["setup", "model"], tModel(apiClient, fromModel));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["config"], liveConnectConfigToMldev$1(fromConfig, toObject));
    }
    return toObject;
  }
  function liveConnectParametersToVertex(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["setup", "model"], tModel(apiClient, fromModel));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["config"], liveConnectConfigToVertex(fromConfig, toObject));
    }
    return toObject;
  }
  function liveMusicSetConfigParametersToMldev(fromObject) {
    const toObject = {};
    const fromMusicGenerationConfig = getValueByPath(fromObject, [
      "musicGenerationConfig"
    ]);
    if (fromMusicGenerationConfig != null) {
      setValueByPath(toObject, ["musicGenerationConfig"], fromMusicGenerationConfig);
    }
    return toObject;
  }
  function liveMusicSetWeightedPromptsParametersToMldev(fromObject) {
    const toObject = {};
    const fromWeightedPrompts = getValueByPath(fromObject, [
      "weightedPrompts"
    ]);
    if (fromWeightedPrompts != null) {
      let transformedList = fromWeightedPrompts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["weightedPrompts"], transformedList);
    }
    return toObject;
  }
  function liveSendRealtimeInputParametersToMldev(fromObject) {
    const toObject = {};
    const fromMedia = getValueByPath(fromObject, ["media"]);
    if (fromMedia != null) {
      let transformedList = tBlobs(fromMedia);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return blobToMldev$2(item);
        });
      }
      setValueByPath(toObject, ["mediaChunks"], transformedList);
    }
    const fromAudio = getValueByPath(fromObject, ["audio"]);
    if (fromAudio != null) {
      setValueByPath(toObject, ["audio"], blobToMldev$2(tAudioBlob(fromAudio)));
    }
    const fromAudioStreamEnd = getValueByPath(fromObject, [
      "audioStreamEnd"
    ]);
    if (fromAudioStreamEnd != null) {
      setValueByPath(toObject, ["audioStreamEnd"], fromAudioStreamEnd);
    }
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["video"], blobToMldev$2(tImageBlob(fromVideo)));
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromActivityStart = getValueByPath(fromObject, [
      "activityStart"
    ]);
    if (fromActivityStart != null) {
      setValueByPath(toObject, ["activityStart"], fromActivityStart);
    }
    const fromActivityEnd = getValueByPath(fromObject, ["activityEnd"]);
    if (fromActivityEnd != null) {
      setValueByPath(toObject, ["activityEnd"], fromActivityEnd);
    }
    return toObject;
  }
  function liveSendRealtimeInputParametersToVertex(fromObject) {
    const toObject = {};
    const fromMedia = getValueByPath(fromObject, ["media"]);
    if (fromMedia != null) {
      let transformedList = tBlobs(fromMedia);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["mediaChunks"], transformedList);
    }
    const fromAudio = getValueByPath(fromObject, ["audio"]);
    if (fromAudio != null) {
      setValueByPath(toObject, ["audio"], tAudioBlob(fromAudio));
    }
    const fromAudioStreamEnd = getValueByPath(fromObject, [
      "audioStreamEnd"
    ]);
    if (fromAudioStreamEnd != null) {
      setValueByPath(toObject, ["audioStreamEnd"], fromAudioStreamEnd);
    }
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["video"], tImageBlob(fromVideo));
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromActivityStart = getValueByPath(fromObject, [
      "activityStart"
    ]);
    if (fromActivityStart != null) {
      setValueByPath(toObject, ["activityStart"], fromActivityStart);
    }
    const fromActivityEnd = getValueByPath(fromObject, ["activityEnd"]);
    if (fromActivityEnd != null) {
      setValueByPath(toObject, ["activityEnd"], fromActivityEnd);
    }
    return toObject;
  }
  function liveServerMessageFromVertex(fromObject) {
    const toObject = {};
    const fromSetupComplete = getValueByPath(fromObject, [
      "setupComplete"
    ]);
    if (fromSetupComplete != null) {
      setValueByPath(toObject, ["setupComplete"], fromSetupComplete);
    }
    const fromServerContent = getValueByPath(fromObject, [
      "serverContent"
    ]);
    if (fromServerContent != null) {
      setValueByPath(toObject, ["serverContent"], fromServerContent);
    }
    const fromToolCall = getValueByPath(fromObject, ["toolCall"]);
    if (fromToolCall != null) {
      setValueByPath(toObject, ["toolCall"], fromToolCall);
    }
    const fromToolCallCancellation = getValueByPath(fromObject, [
      "toolCallCancellation"
    ]);
    if (fromToolCallCancellation != null) {
      setValueByPath(toObject, ["toolCallCancellation"], fromToolCallCancellation);
    }
    const fromUsageMetadata = getValueByPath(fromObject, [
      "usageMetadata"
    ]);
    if (fromUsageMetadata != null) {
      setValueByPath(toObject, ["usageMetadata"], usageMetadataFromVertex(fromUsageMetadata));
    }
    const fromGoAway = getValueByPath(fromObject, ["goAway"]);
    if (fromGoAway != null) {
      setValueByPath(toObject, ["goAway"], fromGoAway);
    }
    const fromSessionResumptionUpdate = getValueByPath(fromObject, [
      "sessionResumptionUpdate"
    ]);
    if (fromSessionResumptionUpdate != null) {
      setValueByPath(toObject, ["sessionResumptionUpdate"], fromSessionResumptionUpdate);
    }
    const fromVoiceActivityDetectionSignal = getValueByPath(fromObject, [
      "voiceActivityDetectionSignal"
    ]);
    if (fromVoiceActivityDetectionSignal != null) {
      setValueByPath(toObject, ["voiceActivityDetectionSignal"], fromVoiceActivityDetectionSignal);
    }
    const fromVoiceActivity = getValueByPath(fromObject, [
      "voiceActivity"
    ]);
    if (fromVoiceActivity != null) {
      setValueByPath(toObject, ["voiceActivity"], voiceActivityFromVertex(fromVoiceActivity));
    }
    return toObject;
  }
  function mcpServerToVertex$1(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["name"]) !== void 0) {
      throw new Error("name parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["streamableHttpTransport"]) !== void 0) {
      throw new Error("streamableHttpTransport parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function partToMldev$2(fromObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], fromCodeExecutionResult);
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], fromExecutableCode);
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fileDataToMldev$2(fromFileData));
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], functionCallToMldev$2(fromFunctionCall));
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], blobToMldev$2(fromInlineData));
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    const fromToolCall = getValueByPath(fromObject, ["toolCall"]);
    if (fromToolCall != null) {
      setValueByPath(toObject, ["toolCall"], fromToolCall);
    }
    const fromToolResponse = getValueByPath(fromObject, ["toolResponse"]);
    if (fromToolResponse != null) {
      setValueByPath(toObject, ["toolResponse"], fromToolResponse);
    }
    const fromPartMetadata = getValueByPath(fromObject, ["partMetadata"]);
    if (fromPartMetadata != null) {
      setValueByPath(toObject, ["partMetadata"], fromPartMetadata);
    }
    return toObject;
  }
  function partToVertex$2(fromObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], codeExecutionResultToVertex$2(fromCodeExecutionResult));
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], executableCodeToVertex$2(fromExecutableCode));
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fromFileData);
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], fromFunctionCall);
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], fromInlineData);
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    if (getValueByPath(fromObject, ["toolCall"]) !== void 0) {
      throw new Error("toolCall parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["toolResponse"]) !== void 0) {
      throw new Error("toolResponse parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["partMetadata"]) !== void 0) {
      throw new Error("partMetadata parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function safetySettingToMldev$2(fromObject) {
    const toObject = {};
    const fromCategory = getValueByPath(fromObject, ["category"]);
    if (fromCategory != null) {
      setValueByPath(toObject, ["category"], fromCategory);
    }
    if (getValueByPath(fromObject, ["method"]) !== void 0) {
      throw new Error("method parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromThreshold = getValueByPath(fromObject, ["threshold"]);
    if (fromThreshold != null) {
      setValueByPath(toObject, ["threshold"], fromThreshold);
    }
    return toObject;
  }
  function sessionResumptionConfigToMldev$1(fromObject) {
    const toObject = {};
    const fromHandle = getValueByPath(fromObject, ["handle"]);
    if (fromHandle != null) {
      setValueByPath(toObject, ["handle"], fromHandle);
    }
    if (getValueByPath(fromObject, ["transparent"]) !== void 0) {
      throw new Error("transparent parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function toolToMldev$2(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["retrieval"]) !== void 0) {
      throw new Error("retrieval parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    const fromFileSearch = getValueByPath(fromObject, ["fileSearch"]);
    if (fromFileSearch != null) {
      setValueByPath(toObject, ["fileSearch"], fromFileSearch);
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], googleSearchToMldev$2(fromGoogleSearch));
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], googleMapsToMldev$2(fromGoogleMaps));
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    if (getValueByPath(fromObject, ["enterpriseWebSearch"]) !== void 0) {
      throw new Error("enterpriseWebSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    if (getValueByPath(fromObject, ["parallelAiSearch"]) !== void 0) {
      throw new Error("parallelAiSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function toolToVertex$1(fromObject) {
    const toObject = {};
    const fromRetrieval = getValueByPath(fromObject, ["retrieval"]);
    if (fromRetrieval != null) {
      setValueByPath(toObject, ["retrieval"], fromRetrieval);
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    if (getValueByPath(fromObject, ["fileSearch"]) !== void 0) {
      throw new Error("fileSearch parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], fromGoogleSearch);
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], fromGoogleMaps);
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    const fromEnterpriseWebSearch = getValueByPath(fromObject, [
      "enterpriseWebSearch"
    ]);
    if (fromEnterpriseWebSearch != null) {
      setValueByPath(toObject, ["enterpriseWebSearch"], fromEnterpriseWebSearch);
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    const fromParallelAiSearch = getValueByPath(fromObject, [
      "parallelAiSearch"
    ]);
    if (fromParallelAiSearch != null) {
      setValueByPath(toObject, ["parallelAiSearch"], fromParallelAiSearch);
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return mcpServerToVertex$1(item);
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function usageMetadataFromVertex(fromObject) {
    const toObject = {};
    const fromPromptTokenCount = getValueByPath(fromObject, [
      "promptTokenCount"
    ]);
    if (fromPromptTokenCount != null) {
      setValueByPath(toObject, ["promptTokenCount"], fromPromptTokenCount);
    }
    const fromCachedContentTokenCount = getValueByPath(fromObject, [
      "cachedContentTokenCount"
    ]);
    if (fromCachedContentTokenCount != null) {
      setValueByPath(toObject, ["cachedContentTokenCount"], fromCachedContentTokenCount);
    }
    const fromResponseTokenCount = getValueByPath(fromObject, [
      "candidatesTokenCount"
    ]);
    if (fromResponseTokenCount != null) {
      setValueByPath(toObject, ["responseTokenCount"], fromResponseTokenCount);
    }
    const fromToolUsePromptTokenCount = getValueByPath(fromObject, [
      "toolUsePromptTokenCount"
    ]);
    if (fromToolUsePromptTokenCount != null) {
      setValueByPath(toObject, ["toolUsePromptTokenCount"], fromToolUsePromptTokenCount);
    }
    const fromThoughtsTokenCount = getValueByPath(fromObject, [
      "thoughtsTokenCount"
    ]);
    if (fromThoughtsTokenCount != null) {
      setValueByPath(toObject, ["thoughtsTokenCount"], fromThoughtsTokenCount);
    }
    const fromTotalTokenCount = getValueByPath(fromObject, [
      "totalTokenCount"
    ]);
    if (fromTotalTokenCount != null) {
      setValueByPath(toObject, ["totalTokenCount"], fromTotalTokenCount);
    }
    const fromPromptTokensDetails = getValueByPath(fromObject, [
      "promptTokensDetails"
    ]);
    if (fromPromptTokensDetails != null) {
      let transformedList = fromPromptTokensDetails;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["promptTokensDetails"], transformedList);
    }
    const fromCacheTokensDetails = getValueByPath(fromObject, [
      "cacheTokensDetails"
    ]);
    if (fromCacheTokensDetails != null) {
      let transformedList = fromCacheTokensDetails;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["cacheTokensDetails"], transformedList);
    }
    const fromResponseTokensDetails = getValueByPath(fromObject, [
      "candidatesTokensDetails"
    ]);
    if (fromResponseTokensDetails != null) {
      let transformedList = fromResponseTokensDetails;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["responseTokensDetails"], transformedList);
    }
    const fromToolUsePromptTokensDetails = getValueByPath(fromObject, [
      "toolUsePromptTokensDetails"
    ]);
    if (fromToolUsePromptTokensDetails != null) {
      let transformedList = fromToolUsePromptTokensDetails;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["toolUsePromptTokensDetails"], transformedList);
    }
    const fromTrafficType = getValueByPath(fromObject, ["trafficType"]);
    if (fromTrafficType != null) {
      setValueByPath(toObject, ["trafficType"], fromTrafficType);
    }
    return toObject;
  }
  function voiceActivityFromVertex(fromObject) {
    const toObject = {};
    const fromVoiceActivityType = getValueByPath(fromObject, ["type"]);
    if (fromVoiceActivityType != null) {
      setValueByPath(toObject, ["voiceActivityType"], fromVoiceActivityType);
    }
    const fromAudioOffset = getValueByPath(fromObject, ["audioOffset"]);
    if (fromAudioOffset != null) {
      setValueByPath(toObject, ["audioOffset"], fromAudioOffset);
    }
    return toObject;
  }
  function authConfigToMldev$1(fromObject, _rootObject) {
    const toObject = {};
    const fromApiKey = getValueByPath(fromObject, ["apiKey"]);
    if (fromApiKey != null) {
      setValueByPath(toObject, ["apiKey"], fromApiKey);
    }
    if (getValueByPath(fromObject, ["apiKeyConfig"]) !== void 0) {
      throw new Error("apiKeyConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["authType"]) !== void 0) {
      throw new Error("authType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["googleServiceAccountConfig"]) !== void 0) {
      throw new Error("googleServiceAccountConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["httpBasicAuthConfig"]) !== void 0) {
      throw new Error("httpBasicAuthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oauthConfig"]) !== void 0) {
      throw new Error("oauthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oidcConfig"]) !== void 0) {
      throw new Error("oidcConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function blobToMldev$1(fromObject, _rootObject) {
    const toObject = {};
    const fromData = getValueByPath(fromObject, ["data"]);
    if (fromData != null) {
      setValueByPath(toObject, ["data"], fromData);
    }
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function candidateFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromContent = getValueByPath(fromObject, ["content"]);
    if (fromContent != null) {
      setValueByPath(toObject, ["content"], fromContent);
    }
    const fromCitationMetadata = getValueByPath(fromObject, [
      "citationMetadata"
    ]);
    if (fromCitationMetadata != null) {
      setValueByPath(toObject, ["citationMetadata"], citationMetadataFromMldev(fromCitationMetadata));
    }
    const fromTokenCount = getValueByPath(fromObject, ["tokenCount"]);
    if (fromTokenCount != null) {
      setValueByPath(toObject, ["tokenCount"], fromTokenCount);
    }
    const fromFinishReason = getValueByPath(fromObject, ["finishReason"]);
    if (fromFinishReason != null) {
      setValueByPath(toObject, ["finishReason"], fromFinishReason);
    }
    const fromGroundingMetadata = getValueByPath(fromObject, [
      "groundingMetadata"
    ]);
    if (fromGroundingMetadata != null) {
      setValueByPath(toObject, ["groundingMetadata"], fromGroundingMetadata);
    }
    const fromAvgLogprobs = getValueByPath(fromObject, ["avgLogprobs"]);
    if (fromAvgLogprobs != null) {
      setValueByPath(toObject, ["avgLogprobs"], fromAvgLogprobs);
    }
    const fromIndex = getValueByPath(fromObject, ["index"]);
    if (fromIndex != null) {
      setValueByPath(toObject, ["index"], fromIndex);
    }
    const fromLogprobsResult = getValueByPath(fromObject, [
      "logprobsResult"
    ]);
    if (fromLogprobsResult != null) {
      setValueByPath(toObject, ["logprobsResult"], fromLogprobsResult);
    }
    const fromSafetyRatings = getValueByPath(fromObject, [
      "safetyRatings"
    ]);
    if (fromSafetyRatings != null) {
      let transformedList = fromSafetyRatings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["safetyRatings"], transformedList);
    }
    const fromUrlContextMetadata = getValueByPath(fromObject, [
      "urlContextMetadata"
    ]);
    if (fromUrlContextMetadata != null) {
      setValueByPath(toObject, ["urlContextMetadata"], fromUrlContextMetadata);
    }
    return toObject;
  }
  function citationMetadataFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromCitations = getValueByPath(fromObject, ["citationSources"]);
    if (fromCitations != null) {
      let transformedList = fromCitations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["citations"], transformedList);
    }
    return toObject;
  }
  function codeExecutionResultToVertex$1(fromObject, _rootObject) {
    const toObject = {};
    const fromOutcome = getValueByPath(fromObject, ["outcome"]);
    if (fromOutcome != null) {
      setValueByPath(toObject, ["outcome"], fromOutcome);
    }
    const fromOutput = getValueByPath(fromObject, ["output"]);
    if (fromOutput != null) {
      setValueByPath(toObject, ["output"], fromOutput);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function computeTokensParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToVertex$1(item);
        });
      }
      setValueByPath(toObject, ["contents"], transformedList);
    }
    return toObject;
  }
  function computeTokensResponseFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromTokensInfo = getValueByPath(fromObject, ["tokensInfo"]);
    if (fromTokensInfo != null) {
      let transformedList = fromTokensInfo;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["tokensInfo"], transformedList);
    }
    return toObject;
  }
  function contentEmbeddingFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromValues = getValueByPath(fromObject, ["values"]);
    if (fromValues != null) {
      setValueByPath(toObject, ["values"], fromValues);
    }
    const fromStatistics = getValueByPath(fromObject, ["statistics"]);
    if (fromStatistics != null) {
      setValueByPath(toObject, ["statistics"], contentEmbeddingStatisticsFromVertex(fromStatistics));
    }
    return toObject;
  }
  function contentEmbeddingStatisticsFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromTruncated = getValueByPath(fromObject, ["truncated"]);
    if (fromTruncated != null) {
      setValueByPath(toObject, ["truncated"], fromTruncated);
    }
    const fromTokenCount = getValueByPath(fromObject, ["token_count"]);
    if (fromTokenCount != null) {
      setValueByPath(toObject, ["tokenCount"], fromTokenCount);
    }
    return toObject;
  }
  function contentToMldev$1(fromObject, rootObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToMldev$1(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function contentToVertex$1(fromObject, rootObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToVertex$1(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function controlReferenceConfigToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromControlType = getValueByPath(fromObject, ["controlType"]);
    if (fromControlType != null) {
      setValueByPath(toObject, ["controlType"], fromControlType);
    }
    const fromEnableControlImageComputation = getValueByPath(fromObject, [
      "enableControlImageComputation"
    ]);
    if (fromEnableControlImageComputation != null) {
      setValueByPath(toObject, ["computeControl"], fromEnableControlImageComputation);
    }
    return toObject;
  }
  function countTokensConfigToMldev(fromObject, _rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["systemInstruction"]) !== void 0) {
      throw new Error("systemInstruction parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["tools"]) !== void 0) {
      throw new Error("tools parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["generationConfig"]) !== void 0) {
      throw new Error("generationConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function countTokensConfigToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["systemInstruction"], contentToVertex$1(tContent(fromSystemInstruction)));
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = fromTools;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToVertex(item);
        });
      }
      setValueByPath(parentObject, ["tools"], transformedList);
    }
    const fromGenerationConfig = getValueByPath(fromObject, [
      "generationConfig"
    ]);
    if (parentObject !== void 0 && fromGenerationConfig != null) {
      setValueByPath(parentObject, ["generationConfig"], generationConfigToVertex(fromGenerationConfig));
    }
    return toObject;
  }
  function countTokensParametersToMldev(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToMldev$1(item);
        });
      }
      setValueByPath(toObject, ["contents"], transformedList);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      countTokensConfigToMldev(fromConfig);
    }
    return toObject;
  }
  function countTokensParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToVertex$1(item);
        });
      }
      setValueByPath(toObject, ["contents"], transformedList);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      countTokensConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function countTokensResponseFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromTotalTokens = getValueByPath(fromObject, ["totalTokens"]);
    if (fromTotalTokens != null) {
      setValueByPath(toObject, ["totalTokens"], fromTotalTokens);
    }
    const fromCachedContentTokenCount = getValueByPath(fromObject, [
      "cachedContentTokenCount"
    ]);
    if (fromCachedContentTokenCount != null) {
      setValueByPath(toObject, ["cachedContentTokenCount"], fromCachedContentTokenCount);
    }
    return toObject;
  }
  function countTokensResponseFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromTotalTokens = getValueByPath(fromObject, ["totalTokens"]);
    if (fromTotalTokens != null) {
      setValueByPath(toObject, ["totalTokens"], fromTotalTokens);
    }
    return toObject;
  }
  function deleteModelParametersToMldev(apiClient, fromObject, _rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "name"], tModel(apiClient, fromModel));
    }
    return toObject;
  }
  function deleteModelParametersToVertex(apiClient, fromObject, _rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "name"], tModel(apiClient, fromModel));
    }
    return toObject;
  }
  function deleteModelResponseFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function deleteModelResponseFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function editImageConfigToVertex(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromOutputGcsUri = getValueByPath(fromObject, ["outputGcsUri"]);
    if (parentObject !== void 0 && fromOutputGcsUri != null) {
      setValueByPath(parentObject, ["parameters", "storageUri"], fromOutputGcsUri);
    }
    const fromNegativePrompt = getValueByPath(fromObject, [
      "negativePrompt"
    ]);
    if (parentObject !== void 0 && fromNegativePrompt != null) {
      setValueByPath(parentObject, ["parameters", "negativePrompt"], fromNegativePrompt);
    }
    const fromNumberOfImages = getValueByPath(fromObject, [
      "numberOfImages"
    ]);
    if (parentObject !== void 0 && fromNumberOfImages != null) {
      setValueByPath(parentObject, ["parameters", "sampleCount"], fromNumberOfImages);
    }
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (parentObject !== void 0 && fromAspectRatio != null) {
      setValueByPath(parentObject, ["parameters", "aspectRatio"], fromAspectRatio);
    }
    const fromGuidanceScale = getValueByPath(fromObject, [
      "guidanceScale"
    ]);
    if (parentObject !== void 0 && fromGuidanceScale != null) {
      setValueByPath(parentObject, ["parameters", "guidanceScale"], fromGuidanceScale);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (parentObject !== void 0 && fromSeed != null) {
      setValueByPath(parentObject, ["parameters", "seed"], fromSeed);
    }
    const fromSafetyFilterLevel = getValueByPath(fromObject, [
      "safetyFilterLevel"
    ]);
    if (parentObject !== void 0 && fromSafetyFilterLevel != null) {
      setValueByPath(parentObject, ["parameters", "safetySetting"], fromSafetyFilterLevel);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (parentObject !== void 0 && fromPersonGeneration != null) {
      setValueByPath(parentObject, ["parameters", "personGeneration"], fromPersonGeneration);
    }
    const fromIncludeSafetyAttributes = getValueByPath(fromObject, [
      "includeSafetyAttributes"
    ]);
    if (parentObject !== void 0 && fromIncludeSafetyAttributes != null) {
      setValueByPath(parentObject, ["parameters", "includeSafetyAttributes"], fromIncludeSafetyAttributes);
    }
    const fromIncludeRaiReason = getValueByPath(fromObject, [
      "includeRaiReason"
    ]);
    if (parentObject !== void 0 && fromIncludeRaiReason != null) {
      setValueByPath(parentObject, ["parameters", "includeRaiReason"], fromIncludeRaiReason);
    }
    const fromLanguage = getValueByPath(fromObject, ["language"]);
    if (parentObject !== void 0 && fromLanguage != null) {
      setValueByPath(parentObject, ["parameters", "language"], fromLanguage);
    }
    const fromOutputMimeType = getValueByPath(fromObject, [
      "outputMimeType"
    ]);
    if (parentObject !== void 0 && fromOutputMimeType != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "mimeType"], fromOutputMimeType);
    }
    const fromOutputCompressionQuality = getValueByPath(fromObject, [
      "outputCompressionQuality"
    ]);
    if (parentObject !== void 0 && fromOutputCompressionQuality != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "compressionQuality"], fromOutputCompressionQuality);
    }
    const fromAddWatermark = getValueByPath(fromObject, ["addWatermark"]);
    if (parentObject !== void 0 && fromAddWatermark != null) {
      setValueByPath(parentObject, ["parameters", "addWatermark"], fromAddWatermark);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    const fromEditMode = getValueByPath(fromObject, ["editMode"]);
    if (parentObject !== void 0 && fromEditMode != null) {
      setValueByPath(parentObject, ["parameters", "editMode"], fromEditMode);
    }
    const fromBaseSteps = getValueByPath(fromObject, ["baseSteps"]);
    if (parentObject !== void 0 && fromBaseSteps != null) {
      setValueByPath(parentObject, ["parameters", "editConfig", "baseSteps"], fromBaseSteps);
    }
    return toObject;
  }
  function editImageParametersInternalToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (fromPrompt != null) {
      setValueByPath(toObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromReferenceImages = getValueByPath(fromObject, [
      "referenceImages"
    ]);
    if (fromReferenceImages != null) {
      let transformedList = fromReferenceImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return referenceImageAPIInternalToVertex(item);
        });
      }
      setValueByPath(toObject, ["instances[0]", "referenceImages"], transformedList);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      editImageConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function editImageResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromGeneratedImages = getValueByPath(fromObject, [
      "predictions"
    ]);
    if (fromGeneratedImages != null) {
      let transformedList = fromGeneratedImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedImageFromVertex(item);
        });
      }
      setValueByPath(toObject, ["generatedImages"], transformedList);
    }
    return toObject;
  }
  function embedContentConfigToMldev(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromTaskType = getValueByPath(fromObject, ["taskType"]);
    if (parentObject !== void 0 && fromTaskType != null) {
      setValueByPath(parentObject, ["requests[]", "taskType"], fromTaskType);
    }
    const fromTitle = getValueByPath(fromObject, ["title"]);
    if (parentObject !== void 0 && fromTitle != null) {
      setValueByPath(parentObject, ["requests[]", "title"], fromTitle);
    }
    const fromOutputDimensionality = getValueByPath(fromObject, [
      "outputDimensionality"
    ]);
    if (parentObject !== void 0 && fromOutputDimensionality != null) {
      setValueByPath(parentObject, ["requests[]", "outputDimensionality"], fromOutputDimensionality);
    }
    if (getValueByPath(fromObject, ["mimeType"]) !== void 0) {
      throw new Error("mimeType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["autoTruncate"]) !== void 0) {
      throw new Error("autoTruncate parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["documentOcr"]) !== void 0) {
      throw new Error("documentOcr parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["audioTrackExtraction"]) !== void 0) {
      throw new Error("audioTrackExtraction parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function embedContentConfigToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    let discriminatorTaskType = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorTaskType === void 0) {
      discriminatorTaskType = "PREDICT";
    }
    if (discriminatorTaskType === "PREDICT") {
      const fromTaskType = getValueByPath(fromObject, ["taskType"]);
      if (parentObject !== void 0 && fromTaskType != null) {
        setValueByPath(parentObject, ["instances[]", "task_type"], fromTaskType);
      }
    } else if (discriminatorTaskType === "EMBED_CONTENT") {
      const fromTaskType = getValueByPath(fromObject, ["taskType"]);
      if (parentObject !== void 0 && fromTaskType != null) {
        setValueByPath(parentObject, ["embedContentConfig", "taskType"], fromTaskType);
      }
    }
    let discriminatorTitle = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorTitle === void 0) {
      discriminatorTitle = "PREDICT";
    }
    if (discriminatorTitle === "PREDICT") {
      const fromTitle = getValueByPath(fromObject, ["title"]);
      if (parentObject !== void 0 && fromTitle != null) {
        setValueByPath(parentObject, ["instances[]", "title"], fromTitle);
      }
    } else if (discriminatorTitle === "EMBED_CONTENT") {
      const fromTitle = getValueByPath(fromObject, ["title"]);
      if (parentObject !== void 0 && fromTitle != null) {
        setValueByPath(parentObject, ["embedContentConfig", "title"], fromTitle);
      }
    }
    let discriminatorOutputDimensionality = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorOutputDimensionality === void 0) {
      discriminatorOutputDimensionality = "PREDICT";
    }
    if (discriminatorOutputDimensionality === "PREDICT") {
      const fromOutputDimensionality = getValueByPath(fromObject, [
        "outputDimensionality"
      ]);
      if (parentObject !== void 0 && fromOutputDimensionality != null) {
        setValueByPath(parentObject, ["parameters", "outputDimensionality"], fromOutputDimensionality);
      }
    } else if (discriminatorOutputDimensionality === "EMBED_CONTENT") {
      const fromOutputDimensionality = getValueByPath(fromObject, [
        "outputDimensionality"
      ]);
      if (parentObject !== void 0 && fromOutputDimensionality != null) {
        setValueByPath(parentObject, ["embedContentConfig", "outputDimensionality"], fromOutputDimensionality);
      }
    }
    let discriminatorMimeType = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorMimeType === void 0) {
      discriminatorMimeType = "PREDICT";
    }
    if (discriminatorMimeType === "PREDICT") {
      const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
      if (parentObject !== void 0 && fromMimeType != null) {
        setValueByPath(parentObject, ["instances[]", "mimeType"], fromMimeType);
      }
    }
    let discriminatorAutoTruncate = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorAutoTruncate === void 0) {
      discriminatorAutoTruncate = "PREDICT";
    }
    if (discriminatorAutoTruncate === "PREDICT") {
      const fromAutoTruncate = getValueByPath(fromObject, [
        "autoTruncate"
      ]);
      if (parentObject !== void 0 && fromAutoTruncate != null) {
        setValueByPath(parentObject, ["parameters", "autoTruncate"], fromAutoTruncate);
      }
    } else if (discriminatorAutoTruncate === "EMBED_CONTENT") {
      const fromAutoTruncate = getValueByPath(fromObject, [
        "autoTruncate"
      ]);
      if (parentObject !== void 0 && fromAutoTruncate != null) {
        setValueByPath(parentObject, ["embedContentConfig", "autoTruncate"], fromAutoTruncate);
      }
    }
    let discriminatorDocumentOcr = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorDocumentOcr === void 0) {
      discriminatorDocumentOcr = "PREDICT";
    }
    if (discriminatorDocumentOcr === "EMBED_CONTENT") {
      const fromDocumentOcr = getValueByPath(fromObject, ["documentOcr"]);
      if (parentObject !== void 0 && fromDocumentOcr != null) {
        setValueByPath(parentObject, ["embedContentConfig", "documentOcr"], fromDocumentOcr);
      }
    }
    let discriminatorAudioTrackExtraction = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorAudioTrackExtraction === void 0) {
      discriminatorAudioTrackExtraction = "PREDICT";
    }
    if (discriminatorAudioTrackExtraction === "EMBED_CONTENT") {
      const fromAudioTrackExtraction = getValueByPath(fromObject, [
        "audioTrackExtraction"
      ]);
      if (parentObject !== void 0 && fromAudioTrackExtraction != null) {
        setValueByPath(parentObject, ["embedContentConfig", "audioTrackExtraction"], fromAudioTrackExtraction);
      }
    }
    return toObject;
  }
  function embedContentParametersPrivateToMldev(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContentsForEmbed(apiClient, fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["requests[]", "content"], transformedList);
    }
    const fromContent = getValueByPath(fromObject, ["content"]);
    if (fromContent != null) {
      contentToMldev$1(tContent(fromContent));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      embedContentConfigToMldev(fromConfig, toObject);
    }
    const fromModelForEmbedContent = getValueByPath(fromObject, ["model"]);
    if (fromModelForEmbedContent !== void 0) {
      setValueByPath(toObject, ["requests[]", "model"], tModel(apiClient, fromModelForEmbedContent));
    }
    return toObject;
  }
  function embedContentParametersPrivateToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    let discriminatorContents = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorContents === void 0) {
      discriminatorContents = "PREDICT";
    }
    if (discriminatorContents === "PREDICT") {
      const fromContents = getValueByPath(fromObject, ["contents"]);
      if (fromContents != null) {
        let transformedList = tContentsForEmbed(apiClient, fromContents);
        if (Array.isArray(transformedList)) {
          transformedList = transformedList.map((item) => {
            return item;
          });
        }
        setValueByPath(toObject, ["instances[]", "content"], transformedList);
      }
    }
    let discriminatorContent = getValueByPath(rootObject, [
      "embeddingApiType"
    ]);
    if (discriminatorContent === void 0) {
      discriminatorContent = "PREDICT";
    }
    if (discriminatorContent === "EMBED_CONTENT") {
      const fromContent = getValueByPath(fromObject, ["content"]);
      if (fromContent != null) {
        setValueByPath(toObject, ["content"], contentToVertex$1(tContent(fromContent)));
      }
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      embedContentConfigToVertex(fromConfig, toObject, rootObject);
    }
    return toObject;
  }
  function embedContentResponseFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromEmbeddings = getValueByPath(fromObject, ["embeddings"]);
    if (fromEmbeddings != null) {
      let transformedList = fromEmbeddings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["embeddings"], transformedList);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    return toObject;
  }
  function embedContentResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromEmbeddings = getValueByPath(fromObject, [
      "predictions[]",
      "embeddings"
    ]);
    if (fromEmbeddings != null) {
      let transformedList = fromEmbeddings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentEmbeddingFromVertex(item);
        });
      }
      setValueByPath(toObject, ["embeddings"], transformedList);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    if (rootObject && getValueByPath(rootObject, ["embeddingApiType"]) === "EMBED_CONTENT") {
      const embedding = getValueByPath(fromObject, ["embedding"]);
      const usageMetadata = getValueByPath(fromObject, ["usageMetadata"]);
      const truncated = getValueByPath(fromObject, ["truncated"]);
      if (embedding) {
        const stats = {};
        if (usageMetadata && usageMetadata["promptTokenCount"]) {
          stats.tokenCount = usageMetadata["promptTokenCount"];
        }
        if (truncated) {
          stats.truncated = truncated;
        }
        embedding.statistics = stats;
        setValueByPath(toObject, ["embeddings"], [embedding]);
      }
    }
    return toObject;
  }
  function endpointFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["endpoint"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromDeployedModelId = getValueByPath(fromObject, [
      "deployedModelId"
    ]);
    if (fromDeployedModelId != null) {
      setValueByPath(toObject, ["deployedModelId"], fromDeployedModelId);
    }
    return toObject;
  }
  function executableCodeToVertex$1(fromObject, _rootObject) {
    const toObject = {};
    const fromCode = getValueByPath(fromObject, ["code"]);
    if (fromCode != null) {
      setValueByPath(toObject, ["code"], fromCode);
    }
    const fromLanguage = getValueByPath(fromObject, ["language"]);
    if (fromLanguage != null) {
      setValueByPath(toObject, ["language"], fromLanguage);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function fileDataToMldev$1(fromObject, _rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFileUri = getValueByPath(fromObject, ["fileUri"]);
    if (fromFileUri != null) {
      setValueByPath(toObject, ["fileUri"], fromFileUri);
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function functionCallToMldev$1(fromObject, _rootObject) {
    const toObject = {};
    const fromId = getValueByPath(fromObject, ["id"]);
    if (fromId != null) {
      setValueByPath(toObject, ["id"], fromId);
    }
    const fromArgs = getValueByPath(fromObject, ["args"]);
    if (fromArgs != null) {
      setValueByPath(toObject, ["args"], fromArgs);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    if (getValueByPath(fromObject, ["partialArgs"]) !== void 0) {
      throw new Error("partialArgs parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["willContinue"]) !== void 0) {
      throw new Error("willContinue parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function functionCallingConfigToMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromAllowedFunctionNames = getValueByPath(fromObject, [
      "allowedFunctionNames"
    ]);
    if (fromAllowedFunctionNames != null) {
      setValueByPath(toObject, ["allowedFunctionNames"], fromAllowedFunctionNames);
    }
    const fromMode = getValueByPath(fromObject, ["mode"]);
    if (fromMode != null) {
      setValueByPath(toObject, ["mode"], fromMode);
    }
    if (getValueByPath(fromObject, ["streamFunctionCallArguments"]) !== void 0) {
      throw new Error("streamFunctionCallArguments parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function generateContentConfigToMldev(apiClient, fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["systemInstruction"], contentToMldev$1(tContent(fromSystemInstruction)));
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (fromTemperature != null) {
      setValueByPath(toObject, ["temperature"], fromTemperature);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (fromTopP != null) {
      setValueByPath(toObject, ["topP"], fromTopP);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (fromTopK != null) {
      setValueByPath(toObject, ["topK"], fromTopK);
    }
    const fromCandidateCount = getValueByPath(fromObject, [
      "candidateCount"
    ]);
    if (fromCandidateCount != null) {
      setValueByPath(toObject, ["candidateCount"], fromCandidateCount);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (fromMaxOutputTokens != null) {
      setValueByPath(toObject, ["maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromStopSequences = getValueByPath(fromObject, [
      "stopSequences"
    ]);
    if (fromStopSequences != null) {
      setValueByPath(toObject, ["stopSequences"], fromStopSequences);
    }
    const fromResponseLogprobs = getValueByPath(fromObject, [
      "responseLogprobs"
    ]);
    if (fromResponseLogprobs != null) {
      setValueByPath(toObject, ["responseLogprobs"], fromResponseLogprobs);
    }
    const fromLogprobs = getValueByPath(fromObject, ["logprobs"]);
    if (fromLogprobs != null) {
      setValueByPath(toObject, ["logprobs"], fromLogprobs);
    }
    const fromPresencePenalty = getValueByPath(fromObject, [
      "presencePenalty"
    ]);
    if (fromPresencePenalty != null) {
      setValueByPath(toObject, ["presencePenalty"], fromPresencePenalty);
    }
    const fromFrequencyPenalty = getValueByPath(fromObject, [
      "frequencyPenalty"
    ]);
    if (fromFrequencyPenalty != null) {
      setValueByPath(toObject, ["frequencyPenalty"], fromFrequencyPenalty);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (fromSeed != null) {
      setValueByPath(toObject, ["seed"], fromSeed);
    }
    const fromResponseMimeType = getValueByPath(fromObject, [
      "responseMimeType"
    ]);
    if (fromResponseMimeType != null) {
      setValueByPath(toObject, ["responseMimeType"], fromResponseMimeType);
    }
    const fromResponseSchema = getValueByPath(fromObject, [
      "responseSchema"
    ]);
    if (fromResponseSchema != null) {
      setValueByPath(toObject, ["responseSchema"], tSchema(fromResponseSchema));
    }
    const fromResponseJsonSchema = getValueByPath(fromObject, [
      "responseJsonSchema"
    ]);
    if (fromResponseJsonSchema != null) {
      setValueByPath(toObject, ["responseJsonSchema"], fromResponseJsonSchema);
    }
    if (getValueByPath(fromObject, ["routingConfig"]) !== void 0) {
      throw new Error("routingConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["modelSelectionConfig"]) !== void 0) {
      throw new Error("modelSelectionConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromSafetySettings = getValueByPath(fromObject, [
      "safetySettings"
    ]);
    if (parentObject !== void 0 && fromSafetySettings != null) {
      let transformedList = fromSafetySettings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return safetySettingToMldev$1(item);
        });
      }
      setValueByPath(parentObject, ["safetySettings"], transformedList);
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = tTools(fromTools);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToMldev$1(tTool(item));
        });
      }
      setValueByPath(parentObject, ["tools"], transformedList);
    }
    const fromToolConfig = getValueByPath(fromObject, ["toolConfig"]);
    if (parentObject !== void 0 && fromToolConfig != null) {
      setValueByPath(parentObject, ["toolConfig"], toolConfigToMldev(fromToolConfig));
    }
    if (getValueByPath(fromObject, ["labels"]) !== void 0) {
      throw new Error("labels parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromCachedContent = getValueByPath(fromObject, [
      "cachedContent"
    ]);
    if (parentObject !== void 0 && fromCachedContent != null) {
      setValueByPath(parentObject, ["cachedContent"], tCachedContentName(apiClient, fromCachedContent));
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (fromResponseModalities != null) {
      setValueByPath(toObject, ["responseModalities"], fromResponseModalities);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (fromSpeechConfig != null) {
      setValueByPath(toObject, ["speechConfig"], tSpeechConfig(fromSpeechConfig));
    }
    if (getValueByPath(fromObject, ["audioTimestamp"]) !== void 0) {
      throw new Error("audioTimestamp parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (fromThinkingConfig != null) {
      setValueByPath(toObject, ["thinkingConfig"], fromThinkingConfig);
    }
    const fromImageConfig = getValueByPath(fromObject, ["imageConfig"]);
    if (fromImageConfig != null) {
      setValueByPath(toObject, ["imageConfig"], imageConfigToMldev(fromImageConfig));
    }
    const fromEnableEnhancedCivicAnswers = getValueByPath(fromObject, [
      "enableEnhancedCivicAnswers"
    ]);
    if (fromEnableEnhancedCivicAnswers != null) {
      setValueByPath(toObject, ["enableEnhancedCivicAnswers"], fromEnableEnhancedCivicAnswers);
    }
    if (getValueByPath(fromObject, ["modelArmorConfig"]) !== void 0) {
      throw new Error("modelArmorConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromServiceTier = getValueByPath(fromObject, ["serviceTier"]);
    if (parentObject !== void 0 && fromServiceTier != null) {
      setValueByPath(parentObject, ["serviceTier"], fromServiceTier);
    }
    return toObject;
  }
  function generateContentConfigToVertex(apiClient, fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["systemInstruction"], contentToVertex$1(tContent(fromSystemInstruction)));
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (fromTemperature != null) {
      setValueByPath(toObject, ["temperature"], fromTemperature);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (fromTopP != null) {
      setValueByPath(toObject, ["topP"], fromTopP);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (fromTopK != null) {
      setValueByPath(toObject, ["topK"], fromTopK);
    }
    const fromCandidateCount = getValueByPath(fromObject, [
      "candidateCount"
    ]);
    if (fromCandidateCount != null) {
      setValueByPath(toObject, ["candidateCount"], fromCandidateCount);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (fromMaxOutputTokens != null) {
      setValueByPath(toObject, ["maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromStopSequences = getValueByPath(fromObject, [
      "stopSequences"
    ]);
    if (fromStopSequences != null) {
      setValueByPath(toObject, ["stopSequences"], fromStopSequences);
    }
    const fromResponseLogprobs = getValueByPath(fromObject, [
      "responseLogprobs"
    ]);
    if (fromResponseLogprobs != null) {
      setValueByPath(toObject, ["responseLogprobs"], fromResponseLogprobs);
    }
    const fromLogprobs = getValueByPath(fromObject, ["logprobs"]);
    if (fromLogprobs != null) {
      setValueByPath(toObject, ["logprobs"], fromLogprobs);
    }
    const fromPresencePenalty = getValueByPath(fromObject, [
      "presencePenalty"
    ]);
    if (fromPresencePenalty != null) {
      setValueByPath(toObject, ["presencePenalty"], fromPresencePenalty);
    }
    const fromFrequencyPenalty = getValueByPath(fromObject, [
      "frequencyPenalty"
    ]);
    if (fromFrequencyPenalty != null) {
      setValueByPath(toObject, ["frequencyPenalty"], fromFrequencyPenalty);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (fromSeed != null) {
      setValueByPath(toObject, ["seed"], fromSeed);
    }
    const fromResponseMimeType = getValueByPath(fromObject, [
      "responseMimeType"
    ]);
    if (fromResponseMimeType != null) {
      setValueByPath(toObject, ["responseMimeType"], fromResponseMimeType);
    }
    const fromResponseSchema = getValueByPath(fromObject, [
      "responseSchema"
    ]);
    if (fromResponseSchema != null) {
      setValueByPath(toObject, ["responseSchema"], tSchema(fromResponseSchema));
    }
    const fromResponseJsonSchema = getValueByPath(fromObject, [
      "responseJsonSchema"
    ]);
    if (fromResponseJsonSchema != null) {
      setValueByPath(toObject, ["responseJsonSchema"], fromResponseJsonSchema);
    }
    const fromRoutingConfig = getValueByPath(fromObject, [
      "routingConfig"
    ]);
    if (fromRoutingConfig != null) {
      setValueByPath(toObject, ["routingConfig"], fromRoutingConfig);
    }
    const fromModelSelectionConfig = getValueByPath(fromObject, [
      "modelSelectionConfig"
    ]);
    if (fromModelSelectionConfig != null) {
      setValueByPath(toObject, ["modelConfig"], fromModelSelectionConfig);
    }
    const fromSafetySettings = getValueByPath(fromObject, [
      "safetySettings"
    ]);
    if (parentObject !== void 0 && fromSafetySettings != null) {
      let transformedList = fromSafetySettings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(parentObject, ["safetySettings"], transformedList);
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = tTools(fromTools);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToVertex(tTool(item));
        });
      }
      setValueByPath(parentObject, ["tools"], transformedList);
    }
    const fromToolConfig = getValueByPath(fromObject, ["toolConfig"]);
    if (parentObject !== void 0 && fromToolConfig != null) {
      setValueByPath(parentObject, ["toolConfig"], toolConfigToVertex(fromToolConfig));
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    const fromCachedContent = getValueByPath(fromObject, [
      "cachedContent"
    ]);
    if (parentObject !== void 0 && fromCachedContent != null) {
      setValueByPath(parentObject, ["cachedContent"], tCachedContentName(apiClient, fromCachedContent));
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (fromResponseModalities != null) {
      setValueByPath(toObject, ["responseModalities"], fromResponseModalities);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (fromSpeechConfig != null) {
      setValueByPath(toObject, ["speechConfig"], tSpeechConfig(fromSpeechConfig));
    }
    const fromAudioTimestamp = getValueByPath(fromObject, [
      "audioTimestamp"
    ]);
    if (fromAudioTimestamp != null) {
      setValueByPath(toObject, ["audioTimestamp"], fromAudioTimestamp);
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (fromThinkingConfig != null) {
      setValueByPath(toObject, ["thinkingConfig"], fromThinkingConfig);
    }
    const fromImageConfig = getValueByPath(fromObject, ["imageConfig"]);
    if (fromImageConfig != null) {
      setValueByPath(toObject, ["imageConfig"], imageConfigToVertex(fromImageConfig));
    }
    if (getValueByPath(fromObject, ["enableEnhancedCivicAnswers"]) !== void 0) {
      throw new Error("enableEnhancedCivicAnswers parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    const fromModelArmorConfig = getValueByPath(fromObject, [
      "modelArmorConfig"
    ]);
    if (parentObject !== void 0 && fromModelArmorConfig != null) {
      setValueByPath(parentObject, ["modelArmorConfig"], fromModelArmorConfig);
    }
    const fromServiceTier = getValueByPath(fromObject, ["serviceTier"]);
    if (parentObject !== void 0 && fromServiceTier != null) {
      setValueByPath(parentObject, ["serviceTier"], fromServiceTier);
    }
    return toObject;
  }
  function generateContentParametersToMldev(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToMldev$1(item);
        });
      }
      setValueByPath(toObject, ["contents"], transformedList);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["generationConfig"], generateContentConfigToMldev(apiClient, fromConfig, toObject));
    }
    return toObject;
  }
  function generateContentParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = tContents(fromContents);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToVertex$1(item);
        });
      }
      setValueByPath(toObject, ["contents"], transformedList);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["generationConfig"], generateContentConfigToVertex(apiClient, fromConfig, toObject));
    }
    return toObject;
  }
  function generateContentResponseFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromCandidates = getValueByPath(fromObject, ["candidates"]);
    if (fromCandidates != null) {
      let transformedList = fromCandidates;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return candidateFromMldev(item);
        });
      }
      setValueByPath(toObject, ["candidates"], transformedList);
    }
    const fromModelVersion = getValueByPath(fromObject, ["modelVersion"]);
    if (fromModelVersion != null) {
      setValueByPath(toObject, ["modelVersion"], fromModelVersion);
    }
    const fromPromptFeedback = getValueByPath(fromObject, [
      "promptFeedback"
    ]);
    if (fromPromptFeedback != null) {
      setValueByPath(toObject, ["promptFeedback"], fromPromptFeedback);
    }
    const fromResponseId = getValueByPath(fromObject, ["responseId"]);
    if (fromResponseId != null) {
      setValueByPath(toObject, ["responseId"], fromResponseId);
    }
    const fromUsageMetadata = getValueByPath(fromObject, [
      "usageMetadata"
    ]);
    if (fromUsageMetadata != null) {
      setValueByPath(toObject, ["usageMetadata"], fromUsageMetadata);
    }
    const fromModelStatus = getValueByPath(fromObject, ["modelStatus"]);
    if (fromModelStatus != null) {
      setValueByPath(toObject, ["modelStatus"], fromModelStatus);
    }
    return toObject;
  }
  function generateContentResponseFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromCandidates = getValueByPath(fromObject, ["candidates"]);
    if (fromCandidates != null) {
      let transformedList = fromCandidates;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["candidates"], transformedList);
    }
    const fromCreateTime = getValueByPath(fromObject, ["createTime"]);
    if (fromCreateTime != null) {
      setValueByPath(toObject, ["createTime"], fromCreateTime);
    }
    const fromModelVersion = getValueByPath(fromObject, ["modelVersion"]);
    if (fromModelVersion != null) {
      setValueByPath(toObject, ["modelVersion"], fromModelVersion);
    }
    const fromPromptFeedback = getValueByPath(fromObject, [
      "promptFeedback"
    ]);
    if (fromPromptFeedback != null) {
      setValueByPath(toObject, ["promptFeedback"], fromPromptFeedback);
    }
    const fromResponseId = getValueByPath(fromObject, ["responseId"]);
    if (fromResponseId != null) {
      setValueByPath(toObject, ["responseId"], fromResponseId);
    }
    const fromUsageMetadata = getValueByPath(fromObject, [
      "usageMetadata"
    ]);
    if (fromUsageMetadata != null) {
      setValueByPath(toObject, ["usageMetadata"], fromUsageMetadata);
    }
    return toObject;
  }
  function generateImagesConfigToMldev(fromObject, parentObject, _rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["outputGcsUri"]) !== void 0) {
      throw new Error("outputGcsUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["negativePrompt"]) !== void 0) {
      throw new Error("negativePrompt parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromNumberOfImages = getValueByPath(fromObject, [
      "numberOfImages"
    ]);
    if (parentObject !== void 0 && fromNumberOfImages != null) {
      setValueByPath(parentObject, ["parameters", "sampleCount"], fromNumberOfImages);
    }
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (parentObject !== void 0 && fromAspectRatio != null) {
      setValueByPath(parentObject, ["parameters", "aspectRatio"], fromAspectRatio);
    }
    const fromGuidanceScale = getValueByPath(fromObject, [
      "guidanceScale"
    ]);
    if (parentObject !== void 0 && fromGuidanceScale != null) {
      setValueByPath(parentObject, ["parameters", "guidanceScale"], fromGuidanceScale);
    }
    if (getValueByPath(fromObject, ["seed"]) !== void 0) {
      throw new Error("seed parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromSafetyFilterLevel = getValueByPath(fromObject, [
      "safetyFilterLevel"
    ]);
    if (parentObject !== void 0 && fromSafetyFilterLevel != null) {
      setValueByPath(parentObject, ["parameters", "safetySetting"], fromSafetyFilterLevel);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (parentObject !== void 0 && fromPersonGeneration != null) {
      setValueByPath(parentObject, ["parameters", "personGeneration"], fromPersonGeneration);
    }
    const fromIncludeSafetyAttributes = getValueByPath(fromObject, [
      "includeSafetyAttributes"
    ]);
    if (parentObject !== void 0 && fromIncludeSafetyAttributes != null) {
      setValueByPath(parentObject, ["parameters", "includeSafetyAttributes"], fromIncludeSafetyAttributes);
    }
    const fromIncludeRaiReason = getValueByPath(fromObject, [
      "includeRaiReason"
    ]);
    if (parentObject !== void 0 && fromIncludeRaiReason != null) {
      setValueByPath(parentObject, ["parameters", "includeRaiReason"], fromIncludeRaiReason);
    }
    const fromLanguage = getValueByPath(fromObject, ["language"]);
    if (parentObject !== void 0 && fromLanguage != null) {
      setValueByPath(parentObject, ["parameters", "language"], fromLanguage);
    }
    const fromOutputMimeType = getValueByPath(fromObject, [
      "outputMimeType"
    ]);
    if (parentObject !== void 0 && fromOutputMimeType != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "mimeType"], fromOutputMimeType);
    }
    const fromOutputCompressionQuality = getValueByPath(fromObject, [
      "outputCompressionQuality"
    ]);
    if (parentObject !== void 0 && fromOutputCompressionQuality != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "compressionQuality"], fromOutputCompressionQuality);
    }
    if (getValueByPath(fromObject, ["addWatermark"]) !== void 0) {
      throw new Error("addWatermark parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["labels"]) !== void 0) {
      throw new Error("labels parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromImageSize = getValueByPath(fromObject, ["imageSize"]);
    if (parentObject !== void 0 && fromImageSize != null) {
      setValueByPath(parentObject, ["parameters", "sampleImageSize"], fromImageSize);
    }
    if (getValueByPath(fromObject, ["enhancePrompt"]) !== void 0) {
      throw new Error("enhancePrompt parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function generateImagesConfigToVertex(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromOutputGcsUri = getValueByPath(fromObject, ["outputGcsUri"]);
    if (parentObject !== void 0 && fromOutputGcsUri != null) {
      setValueByPath(parentObject, ["parameters", "storageUri"], fromOutputGcsUri);
    }
    const fromNegativePrompt = getValueByPath(fromObject, [
      "negativePrompt"
    ]);
    if (parentObject !== void 0 && fromNegativePrompt != null) {
      setValueByPath(parentObject, ["parameters", "negativePrompt"], fromNegativePrompt);
    }
    const fromNumberOfImages = getValueByPath(fromObject, [
      "numberOfImages"
    ]);
    if (parentObject !== void 0 && fromNumberOfImages != null) {
      setValueByPath(parentObject, ["parameters", "sampleCount"], fromNumberOfImages);
    }
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (parentObject !== void 0 && fromAspectRatio != null) {
      setValueByPath(parentObject, ["parameters", "aspectRatio"], fromAspectRatio);
    }
    const fromGuidanceScale = getValueByPath(fromObject, [
      "guidanceScale"
    ]);
    if (parentObject !== void 0 && fromGuidanceScale != null) {
      setValueByPath(parentObject, ["parameters", "guidanceScale"], fromGuidanceScale);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (parentObject !== void 0 && fromSeed != null) {
      setValueByPath(parentObject, ["parameters", "seed"], fromSeed);
    }
    const fromSafetyFilterLevel = getValueByPath(fromObject, [
      "safetyFilterLevel"
    ]);
    if (parentObject !== void 0 && fromSafetyFilterLevel != null) {
      setValueByPath(parentObject, ["parameters", "safetySetting"], fromSafetyFilterLevel);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (parentObject !== void 0 && fromPersonGeneration != null) {
      setValueByPath(parentObject, ["parameters", "personGeneration"], fromPersonGeneration);
    }
    const fromIncludeSafetyAttributes = getValueByPath(fromObject, [
      "includeSafetyAttributes"
    ]);
    if (parentObject !== void 0 && fromIncludeSafetyAttributes != null) {
      setValueByPath(parentObject, ["parameters", "includeSafetyAttributes"], fromIncludeSafetyAttributes);
    }
    const fromIncludeRaiReason = getValueByPath(fromObject, [
      "includeRaiReason"
    ]);
    if (parentObject !== void 0 && fromIncludeRaiReason != null) {
      setValueByPath(parentObject, ["parameters", "includeRaiReason"], fromIncludeRaiReason);
    }
    const fromLanguage = getValueByPath(fromObject, ["language"]);
    if (parentObject !== void 0 && fromLanguage != null) {
      setValueByPath(parentObject, ["parameters", "language"], fromLanguage);
    }
    const fromOutputMimeType = getValueByPath(fromObject, [
      "outputMimeType"
    ]);
    if (parentObject !== void 0 && fromOutputMimeType != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "mimeType"], fromOutputMimeType);
    }
    const fromOutputCompressionQuality = getValueByPath(fromObject, [
      "outputCompressionQuality"
    ]);
    if (parentObject !== void 0 && fromOutputCompressionQuality != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "compressionQuality"], fromOutputCompressionQuality);
    }
    const fromAddWatermark = getValueByPath(fromObject, ["addWatermark"]);
    if (parentObject !== void 0 && fromAddWatermark != null) {
      setValueByPath(parentObject, ["parameters", "addWatermark"], fromAddWatermark);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    const fromImageSize = getValueByPath(fromObject, ["imageSize"]);
    if (parentObject !== void 0 && fromImageSize != null) {
      setValueByPath(parentObject, ["parameters", "sampleImageSize"], fromImageSize);
    }
    const fromEnhancePrompt = getValueByPath(fromObject, [
      "enhancePrompt"
    ]);
    if (parentObject !== void 0 && fromEnhancePrompt != null) {
      setValueByPath(parentObject, ["parameters", "enhancePrompt"], fromEnhancePrompt);
    }
    return toObject;
  }
  function generateImagesParametersToMldev(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (fromPrompt != null) {
      setValueByPath(toObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      generateImagesConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function generateImagesParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (fromPrompt != null) {
      setValueByPath(toObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      generateImagesConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function generateImagesResponseFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromGeneratedImages = getValueByPath(fromObject, [
      "predictions"
    ]);
    if (fromGeneratedImages != null) {
      let transformedList = fromGeneratedImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedImageFromMldev(item);
        });
      }
      setValueByPath(toObject, ["generatedImages"], transformedList);
    }
    const fromPositivePromptSafetyAttributes = getValueByPath(fromObject, [
      "positivePromptSafetyAttributes"
    ]);
    if (fromPositivePromptSafetyAttributes != null) {
      setValueByPath(toObject, ["positivePromptSafetyAttributes"], safetyAttributesFromMldev(fromPositivePromptSafetyAttributes));
    }
    return toObject;
  }
  function generateImagesResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromGeneratedImages = getValueByPath(fromObject, [
      "predictions"
    ]);
    if (fromGeneratedImages != null) {
      let transformedList = fromGeneratedImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedImageFromVertex(item);
        });
      }
      setValueByPath(toObject, ["generatedImages"], transformedList);
    }
    const fromPositivePromptSafetyAttributes = getValueByPath(fromObject, [
      "positivePromptSafetyAttributes"
    ]);
    if (fromPositivePromptSafetyAttributes != null) {
      setValueByPath(toObject, ["positivePromptSafetyAttributes"], safetyAttributesFromVertex(fromPositivePromptSafetyAttributes));
    }
    return toObject;
  }
  function generateVideosConfigToMldev(fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromNumberOfVideos = getValueByPath(fromObject, [
      "numberOfVideos"
    ]);
    if (parentObject !== void 0 && fromNumberOfVideos != null) {
      setValueByPath(parentObject, ["parameters", "sampleCount"], fromNumberOfVideos);
    }
    if (getValueByPath(fromObject, ["outputGcsUri"]) !== void 0) {
      throw new Error("outputGcsUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["fps"]) !== void 0) {
      throw new Error("fps parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromDurationSeconds = getValueByPath(fromObject, [
      "durationSeconds"
    ]);
    if (parentObject !== void 0 && fromDurationSeconds != null) {
      setValueByPath(parentObject, ["parameters", "durationSeconds"], fromDurationSeconds);
    }
    if (getValueByPath(fromObject, ["seed"]) !== void 0) {
      throw new Error("seed parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (parentObject !== void 0 && fromAspectRatio != null) {
      setValueByPath(parentObject, ["parameters", "aspectRatio"], fromAspectRatio);
    }
    const fromResolution = getValueByPath(fromObject, ["resolution"]);
    if (parentObject !== void 0 && fromResolution != null) {
      setValueByPath(parentObject, ["parameters", "resolution"], fromResolution);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (parentObject !== void 0 && fromPersonGeneration != null) {
      setValueByPath(parentObject, ["parameters", "personGeneration"], fromPersonGeneration);
    }
    if (getValueByPath(fromObject, ["pubsubTopic"]) !== void 0) {
      throw new Error("pubsubTopic parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromNegativePrompt = getValueByPath(fromObject, [
      "negativePrompt"
    ]);
    if (parentObject !== void 0 && fromNegativePrompt != null) {
      setValueByPath(parentObject, ["parameters", "negativePrompt"], fromNegativePrompt);
    }
    const fromEnhancePrompt = getValueByPath(fromObject, [
      "enhancePrompt"
    ]);
    if (parentObject !== void 0 && fromEnhancePrompt != null) {
      setValueByPath(parentObject, ["parameters", "enhancePrompt"], fromEnhancePrompt);
    }
    if (getValueByPath(fromObject, ["generateAudio"]) !== void 0) {
      throw new Error("generateAudio parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromLastFrame = getValueByPath(fromObject, ["lastFrame"]);
    if (parentObject !== void 0 && fromLastFrame != null) {
      setValueByPath(parentObject, ["instances[0]", "lastFrame"], imageToMldev(fromLastFrame));
    }
    const fromReferenceImages = getValueByPath(fromObject, [
      "referenceImages"
    ]);
    if (parentObject !== void 0 && fromReferenceImages != null) {
      let transformedList = fromReferenceImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return videoGenerationReferenceImageToMldev(item);
        });
      }
      setValueByPath(parentObject, ["instances[0]", "referenceImages"], transformedList);
    }
    if (getValueByPath(fromObject, ["mask"]) !== void 0) {
      throw new Error("mask parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["compressionQuality"]) !== void 0) {
      throw new Error("compressionQuality parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["labels"]) !== void 0) {
      throw new Error("labels parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromWebhookConfig = getValueByPath(fromObject, [
      "webhookConfig"
    ]);
    if (parentObject !== void 0 && fromWebhookConfig != null) {
      setValueByPath(parentObject, ["webhookConfig"], fromWebhookConfig);
    }
    if (getValueByPath(fromObject, ["resizeMode"]) !== void 0) {
      throw new Error("resizeMode parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function generateVideosConfigToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromNumberOfVideos = getValueByPath(fromObject, [
      "numberOfVideos"
    ]);
    if (parentObject !== void 0 && fromNumberOfVideos != null) {
      setValueByPath(parentObject, ["parameters", "sampleCount"], fromNumberOfVideos);
    }
    const fromOutputGcsUri = getValueByPath(fromObject, ["outputGcsUri"]);
    if (parentObject !== void 0 && fromOutputGcsUri != null) {
      setValueByPath(parentObject, ["parameters", "storageUri"], fromOutputGcsUri);
    }
    const fromFps = getValueByPath(fromObject, ["fps"]);
    if (parentObject !== void 0 && fromFps != null) {
      setValueByPath(parentObject, ["parameters", "fps"], fromFps);
    }
    const fromDurationSeconds = getValueByPath(fromObject, [
      "durationSeconds"
    ]);
    if (parentObject !== void 0 && fromDurationSeconds != null) {
      setValueByPath(parentObject, ["parameters", "durationSeconds"], fromDurationSeconds);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (parentObject !== void 0 && fromSeed != null) {
      setValueByPath(parentObject, ["parameters", "seed"], fromSeed);
    }
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (parentObject !== void 0 && fromAspectRatio != null) {
      setValueByPath(parentObject, ["parameters", "aspectRatio"], fromAspectRatio);
    }
    const fromResolution = getValueByPath(fromObject, ["resolution"]);
    if (parentObject !== void 0 && fromResolution != null) {
      setValueByPath(parentObject, ["parameters", "resolution"], fromResolution);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (parentObject !== void 0 && fromPersonGeneration != null) {
      setValueByPath(parentObject, ["parameters", "personGeneration"], fromPersonGeneration);
    }
    const fromPubsubTopic = getValueByPath(fromObject, ["pubsubTopic"]);
    if (parentObject !== void 0 && fromPubsubTopic != null) {
      setValueByPath(parentObject, ["parameters", "pubsubTopic"], fromPubsubTopic);
    }
    const fromNegativePrompt = getValueByPath(fromObject, [
      "negativePrompt"
    ]);
    if (parentObject !== void 0 && fromNegativePrompt != null) {
      setValueByPath(parentObject, ["parameters", "negativePrompt"], fromNegativePrompt);
    }
    const fromEnhancePrompt = getValueByPath(fromObject, [
      "enhancePrompt"
    ]);
    if (parentObject !== void 0 && fromEnhancePrompt != null) {
      setValueByPath(parentObject, ["parameters", "enhancePrompt"], fromEnhancePrompt);
    }
    const fromGenerateAudio = getValueByPath(fromObject, [
      "generateAudio"
    ]);
    if (parentObject !== void 0 && fromGenerateAudio != null) {
      setValueByPath(parentObject, ["parameters", "generateAudio"], fromGenerateAudio);
    }
    const fromLastFrame = getValueByPath(fromObject, ["lastFrame"]);
    if (parentObject !== void 0 && fromLastFrame != null) {
      setValueByPath(parentObject, ["instances[0]", "lastFrame"], imageToVertex(fromLastFrame));
    }
    const fromReferenceImages = getValueByPath(fromObject, [
      "referenceImages"
    ]);
    if (parentObject !== void 0 && fromReferenceImages != null) {
      let transformedList = fromReferenceImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return videoGenerationReferenceImageToVertex(item);
        });
      }
      setValueByPath(parentObject, ["instances[0]", "referenceImages"], transformedList);
    }
    const fromMask = getValueByPath(fromObject, ["mask"]);
    if (parentObject !== void 0 && fromMask != null) {
      setValueByPath(parentObject, ["instances[0]", "mask"], videoGenerationMaskToVertex(fromMask));
    }
    const fromCompressionQuality = getValueByPath(fromObject, [
      "compressionQuality"
    ]);
    if (parentObject !== void 0 && fromCompressionQuality != null) {
      setValueByPath(parentObject, ["parameters", "compressionQuality"], fromCompressionQuality);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    if (getValueByPath(fromObject, ["webhookConfig"]) !== void 0) {
      throw new Error("webhookConfig parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    const fromResizeMode = getValueByPath(fromObject, ["resizeMode"]);
    if (parentObject !== void 0 && fromResizeMode != null) {
      setValueByPath(parentObject, ["parameters", "resizeMode"], fromResizeMode);
    }
    return toObject;
  }
  function generateVideosOperationFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromResponse = getValueByPath(fromObject, [
      "response",
      "generateVideoResponse"
    ]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], generateVideosResponseFromMldev(fromResponse));
    }
    return toObject;
  }
  function generateVideosOperationFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromResponse = getValueByPath(fromObject, ["response"]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], generateVideosResponseFromVertex(fromResponse));
    }
    return toObject;
  }
  function generateVideosParametersToMldev(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (fromPrompt != null) {
      setValueByPath(toObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["instances[0]", "image"], imageToMldev(fromImage));
    }
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["instances[0]", "video"], videoToMldev(fromVideo));
    }
    const fromSource = getValueByPath(fromObject, ["source"]);
    if (fromSource != null) {
      generateVideosSourceToMldev(fromSource, toObject);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      generateVideosConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function generateVideosParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (fromPrompt != null) {
      setValueByPath(toObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["instances[0]", "image"], imageToVertex(fromImage));
    }
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["instances[0]", "video"], videoToVertex(fromVideo));
    }
    const fromSource = getValueByPath(fromObject, ["source"]);
    if (fromSource != null) {
      generateVideosSourceToVertex(fromSource, toObject);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      generateVideosConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function generateVideosResponseFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromGeneratedVideos = getValueByPath(fromObject, [
      "generatedSamples"
    ]);
    if (fromGeneratedVideos != null) {
      let transformedList = fromGeneratedVideos;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedVideoFromMldev(item);
        });
      }
      setValueByPath(toObject, ["generatedVideos"], transformedList);
    }
    const fromRaiMediaFilteredCount = getValueByPath(fromObject, [
      "raiMediaFilteredCount"
    ]);
    if (fromRaiMediaFilteredCount != null) {
      setValueByPath(toObject, ["raiMediaFilteredCount"], fromRaiMediaFilteredCount);
    }
    const fromRaiMediaFilteredReasons = getValueByPath(fromObject, [
      "raiMediaFilteredReasons"
    ]);
    if (fromRaiMediaFilteredReasons != null) {
      setValueByPath(toObject, ["raiMediaFilteredReasons"], fromRaiMediaFilteredReasons);
    }
    return toObject;
  }
  function generateVideosResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromGeneratedVideos = getValueByPath(fromObject, ["videos"]);
    if (fromGeneratedVideos != null) {
      let transformedList = fromGeneratedVideos;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedVideoFromVertex(item);
        });
      }
      setValueByPath(toObject, ["generatedVideos"], transformedList);
    }
    const fromRaiMediaFilteredCount = getValueByPath(fromObject, [
      "raiMediaFilteredCount"
    ]);
    if (fromRaiMediaFilteredCount != null) {
      setValueByPath(toObject, ["raiMediaFilteredCount"], fromRaiMediaFilteredCount);
    }
    const fromRaiMediaFilteredReasons = getValueByPath(fromObject, [
      "raiMediaFilteredReasons"
    ]);
    if (fromRaiMediaFilteredReasons != null) {
      setValueByPath(toObject, ["raiMediaFilteredReasons"], fromRaiMediaFilteredReasons);
    }
    return toObject;
  }
  function generateVideosSourceToMldev(fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (parentObject !== void 0 && fromPrompt != null) {
      setValueByPath(parentObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (parentObject !== void 0 && fromImage != null) {
      setValueByPath(parentObject, ["instances[0]", "image"], imageToMldev(fromImage));
    }
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (parentObject !== void 0 && fromVideo != null) {
      setValueByPath(parentObject, ["instances[0]", "video"], videoToMldev(fromVideo));
    }
    return toObject;
  }
  function generateVideosSourceToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (parentObject !== void 0 && fromPrompt != null) {
      setValueByPath(parentObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (parentObject !== void 0 && fromImage != null) {
      setValueByPath(parentObject, ["instances[0]", "image"], imageToVertex(fromImage));
    }
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (parentObject !== void 0 && fromVideo != null) {
      setValueByPath(parentObject, ["instances[0]", "video"], videoToVertex(fromVideo));
    }
    return toObject;
  }
  function generatedImageFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromImage = getValueByPath(fromObject, ["_self"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["image"], imageFromMldev(fromImage));
    }
    const fromRaiFilteredReason = getValueByPath(fromObject, [
      "raiFilteredReason"
    ]);
    if (fromRaiFilteredReason != null) {
      setValueByPath(toObject, ["raiFilteredReason"], fromRaiFilteredReason);
    }
    const fromSafetyAttributes = getValueByPath(fromObject, ["_self"]);
    if (fromSafetyAttributes != null) {
      setValueByPath(toObject, ["safetyAttributes"], safetyAttributesFromMldev(fromSafetyAttributes));
    }
    return toObject;
  }
  function generatedImageFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromImage = getValueByPath(fromObject, ["_self"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["image"], imageFromVertex(fromImage));
    }
    const fromRaiFilteredReason = getValueByPath(fromObject, [
      "raiFilteredReason"
    ]);
    if (fromRaiFilteredReason != null) {
      setValueByPath(toObject, ["raiFilteredReason"], fromRaiFilteredReason);
    }
    const fromSafetyAttributes = getValueByPath(fromObject, ["_self"]);
    if (fromSafetyAttributes != null) {
      setValueByPath(toObject, ["safetyAttributes"], safetyAttributesFromVertex(fromSafetyAttributes));
    }
    const fromEnhancedPrompt = getValueByPath(fromObject, ["prompt"]);
    if (fromEnhancedPrompt != null) {
      setValueByPath(toObject, ["enhancedPrompt"], fromEnhancedPrompt);
    }
    return toObject;
  }
  function generatedImageMaskFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromMask = getValueByPath(fromObject, ["_self"]);
    if (fromMask != null) {
      setValueByPath(toObject, ["mask"], imageFromVertex(fromMask));
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (fromLabels != null) {
      let transformedList = fromLabels;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["labels"], transformedList);
    }
    return toObject;
  }
  function generatedVideoFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromVideo = getValueByPath(fromObject, ["video"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["video"], videoFromMldev(fromVideo));
    }
    return toObject;
  }
  function generatedVideoFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromVideo = getValueByPath(fromObject, ["_self"]);
    if (fromVideo != null) {
      setValueByPath(toObject, ["video"], videoFromVertex(fromVideo));
    }
    return toObject;
  }
  function generationConfigToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromModelSelectionConfig = getValueByPath(fromObject, [
      "modelSelectionConfig"
    ]);
    if (fromModelSelectionConfig != null) {
      setValueByPath(toObject, ["modelConfig"], fromModelSelectionConfig);
    }
    const fromResponseJsonSchema = getValueByPath(fromObject, [
      "responseJsonSchema"
    ]);
    if (fromResponseJsonSchema != null) {
      setValueByPath(toObject, ["responseJsonSchema"], fromResponseJsonSchema);
    }
    const fromAudioTimestamp = getValueByPath(fromObject, [
      "audioTimestamp"
    ]);
    if (fromAudioTimestamp != null) {
      setValueByPath(toObject, ["audioTimestamp"], fromAudioTimestamp);
    }
    const fromCandidateCount = getValueByPath(fromObject, [
      "candidateCount"
    ]);
    if (fromCandidateCount != null) {
      setValueByPath(toObject, ["candidateCount"], fromCandidateCount);
    }
    const fromEnableAffectiveDialog = getValueByPath(fromObject, [
      "enableAffectiveDialog"
    ]);
    if (fromEnableAffectiveDialog != null) {
      setValueByPath(toObject, ["enableAffectiveDialog"], fromEnableAffectiveDialog);
    }
    const fromFrequencyPenalty = getValueByPath(fromObject, [
      "frequencyPenalty"
    ]);
    if (fromFrequencyPenalty != null) {
      setValueByPath(toObject, ["frequencyPenalty"], fromFrequencyPenalty);
    }
    const fromLogprobs = getValueByPath(fromObject, ["logprobs"]);
    if (fromLogprobs != null) {
      setValueByPath(toObject, ["logprobs"], fromLogprobs);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (fromMaxOutputTokens != null) {
      setValueByPath(toObject, ["maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromPresencePenalty = getValueByPath(fromObject, [
      "presencePenalty"
    ]);
    if (fromPresencePenalty != null) {
      setValueByPath(toObject, ["presencePenalty"], fromPresencePenalty);
    }
    const fromResponseLogprobs = getValueByPath(fromObject, [
      "responseLogprobs"
    ]);
    if (fromResponseLogprobs != null) {
      setValueByPath(toObject, ["responseLogprobs"], fromResponseLogprobs);
    }
    const fromResponseMimeType = getValueByPath(fromObject, [
      "responseMimeType"
    ]);
    if (fromResponseMimeType != null) {
      setValueByPath(toObject, ["responseMimeType"], fromResponseMimeType);
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (fromResponseModalities != null) {
      setValueByPath(toObject, ["responseModalities"], fromResponseModalities);
    }
    const fromResponseSchema = getValueByPath(fromObject, [
      "responseSchema"
    ]);
    if (fromResponseSchema != null) {
      setValueByPath(toObject, ["responseSchema"], fromResponseSchema);
    }
    const fromRoutingConfig = getValueByPath(fromObject, [
      "routingConfig"
    ]);
    if (fromRoutingConfig != null) {
      setValueByPath(toObject, ["routingConfig"], fromRoutingConfig);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (fromSeed != null) {
      setValueByPath(toObject, ["seed"], fromSeed);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (fromSpeechConfig != null) {
      setValueByPath(toObject, ["speechConfig"], fromSpeechConfig);
    }
    const fromStopSequences = getValueByPath(fromObject, [
      "stopSequences"
    ]);
    if (fromStopSequences != null) {
      setValueByPath(toObject, ["stopSequences"], fromStopSequences);
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (fromTemperature != null) {
      setValueByPath(toObject, ["temperature"], fromTemperature);
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (fromThinkingConfig != null) {
      setValueByPath(toObject, ["thinkingConfig"], fromThinkingConfig);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (fromTopK != null) {
      setValueByPath(toObject, ["topK"], fromTopK);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (fromTopP != null) {
      setValueByPath(toObject, ["topP"], fromTopP);
    }
    if (getValueByPath(fromObject, ["enableEnhancedCivicAnswers"]) !== void 0) {
      throw new Error("enableEnhancedCivicAnswers parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function getModelParametersToMldev(apiClient, fromObject, _rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "name"], tModel(apiClient, fromModel));
    }
    return toObject;
  }
  function getModelParametersToVertex(apiClient, fromObject, _rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "name"], tModel(apiClient, fromModel));
    }
    return toObject;
  }
  function googleMapsToMldev$1(fromObject, rootObject) {
    const toObject = {};
    const fromAuthConfig = getValueByPath(fromObject, ["authConfig"]);
    if (fromAuthConfig != null) {
      setValueByPath(toObject, ["authConfig"], authConfigToMldev$1(fromAuthConfig));
    }
    const fromEnableWidget = getValueByPath(fromObject, ["enableWidget"]);
    if (fromEnableWidget != null) {
      setValueByPath(toObject, ["enableWidget"], fromEnableWidget);
    }
    return toObject;
  }
  function googleSearchToMldev$1(fromObject, _rootObject) {
    const toObject = {};
    const fromSearchTypes = getValueByPath(fromObject, ["searchTypes"]);
    if (fromSearchTypes != null) {
      setValueByPath(toObject, ["searchTypes"], fromSearchTypes);
    }
    if (getValueByPath(fromObject, ["blockingConfidence"]) !== void 0) {
      throw new Error("blockingConfidence parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["excludeDomains"]) !== void 0) {
      throw new Error("excludeDomains parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromTimeRangeFilter = getValueByPath(fromObject, [
      "timeRangeFilter"
    ]);
    if (fromTimeRangeFilter != null) {
      setValueByPath(toObject, ["timeRangeFilter"], fromTimeRangeFilter);
    }
    return toObject;
  }
  function imageConfigToMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (fromAspectRatio != null) {
      setValueByPath(toObject, ["aspectRatio"], fromAspectRatio);
    }
    const fromImageSize = getValueByPath(fromObject, ["imageSize"]);
    if (fromImageSize != null) {
      setValueByPath(toObject, ["imageSize"], fromImageSize);
    }
    if (getValueByPath(fromObject, ["personGeneration"]) !== void 0) {
      throw new Error("personGeneration parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["prominentPeople"]) !== void 0) {
      throw new Error("prominentPeople parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["outputMimeType"]) !== void 0) {
      throw new Error("outputMimeType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["outputCompressionQuality"]) !== void 0) {
      throw new Error("outputCompressionQuality parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["imageOutputOptions"]) !== void 0) {
      throw new Error("imageOutputOptions parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function imageConfigToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromAspectRatio = getValueByPath(fromObject, ["aspectRatio"]);
    if (fromAspectRatio != null) {
      setValueByPath(toObject, ["aspectRatio"], fromAspectRatio);
    }
    const fromImageSize = getValueByPath(fromObject, ["imageSize"]);
    if (fromImageSize != null) {
      setValueByPath(toObject, ["imageSize"], fromImageSize);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (fromPersonGeneration != null) {
      setValueByPath(toObject, ["personGeneration"], fromPersonGeneration);
    }
    const fromProminentPeople = getValueByPath(fromObject, [
      "prominentPeople"
    ]);
    if (fromProminentPeople != null) {
      setValueByPath(toObject, ["prominentPeople"], fromProminentPeople);
    }
    const fromOutputMimeType = getValueByPath(fromObject, [
      "outputMimeType"
    ]);
    if (fromOutputMimeType != null) {
      setValueByPath(toObject, ["imageOutputOptions", "mimeType"], fromOutputMimeType);
    }
    const fromOutputCompressionQuality = getValueByPath(fromObject, [
      "outputCompressionQuality"
    ]);
    if (fromOutputCompressionQuality != null) {
      setValueByPath(toObject, ["imageOutputOptions", "compressionQuality"], fromOutputCompressionQuality);
    }
    const fromImageOutputOptions = getValueByPath(fromObject, [
      "imageOutputOptions"
    ]);
    if (fromImageOutputOptions != null) {
      setValueByPath(toObject, ["imageOutputOptions"], fromImageOutputOptions);
    }
    return toObject;
  }
  function imageFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromImageBytes = getValueByPath(fromObject, [
      "bytesBase64Encoded"
    ]);
    if (fromImageBytes != null) {
      setValueByPath(toObject, ["imageBytes"], tBytes(fromImageBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function imageFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
    if (fromGcsUri != null) {
      setValueByPath(toObject, ["gcsUri"], fromGcsUri);
    }
    const fromImageBytes = getValueByPath(fromObject, [
      "bytesBase64Encoded"
    ]);
    if (fromImageBytes != null) {
      setValueByPath(toObject, ["imageBytes"], tBytes(fromImageBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function imageToMldev(fromObject, _rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["gcsUri"]) !== void 0) {
      throw new Error("gcsUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromImageBytes = getValueByPath(fromObject, ["imageBytes"]);
    if (fromImageBytes != null) {
      setValueByPath(toObject, ["bytesBase64Encoded"], tBytes(fromImageBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function imageToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
    if (fromGcsUri != null) {
      setValueByPath(toObject, ["gcsUri"], fromGcsUri);
    }
    const fromImageBytes = getValueByPath(fromObject, ["imageBytes"]);
    if (fromImageBytes != null) {
      setValueByPath(toObject, ["bytesBase64Encoded"], tBytes(fromImageBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function listModelsConfigToMldev(apiClient, fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    const fromFilter = getValueByPath(fromObject, ["filter"]);
    if (parentObject !== void 0 && fromFilter != null) {
      setValueByPath(parentObject, ["_query", "filter"], fromFilter);
    }
    const fromQueryBase = getValueByPath(fromObject, ["queryBase"]);
    if (parentObject !== void 0 && fromQueryBase != null) {
      setValueByPath(parentObject, ["_url", "models_url"], tModelsUrl(apiClient, fromQueryBase));
    }
    return toObject;
  }
  function listModelsConfigToVertex(apiClient, fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    const fromFilter = getValueByPath(fromObject, ["filter"]);
    if (parentObject !== void 0 && fromFilter != null) {
      setValueByPath(parentObject, ["_query", "filter"], fromFilter);
    }
    const fromQueryBase = getValueByPath(fromObject, ["queryBase"]);
    if (parentObject !== void 0 && fromQueryBase != null) {
      setValueByPath(parentObject, ["_url", "models_url"], tModelsUrl(apiClient, fromQueryBase));
    }
    return toObject;
  }
  function listModelsParametersToMldev(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listModelsConfigToMldev(apiClient, fromConfig, toObject);
    }
    return toObject;
  }
  function listModelsParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listModelsConfigToVertex(apiClient, fromConfig, toObject);
    }
    return toObject;
  }
  function listModelsResponseFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromModels = getValueByPath(fromObject, ["_self"]);
    if (fromModels != null) {
      let transformedList = tExtractModels(fromModels);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return modelFromMldev(item);
        });
      }
      setValueByPath(toObject, ["models"], transformedList);
    }
    return toObject;
  }
  function listModelsResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromModels = getValueByPath(fromObject, ["_self"]);
    if (fromModels != null) {
      let transformedList = tExtractModels(fromModels);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return modelFromVertex(item);
        });
      }
      setValueByPath(toObject, ["models"], transformedList);
    }
    return toObject;
  }
  function maskReferenceConfigToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromMaskMode = getValueByPath(fromObject, ["maskMode"]);
    if (fromMaskMode != null) {
      setValueByPath(toObject, ["maskMode"], fromMaskMode);
    }
    const fromSegmentationClasses = getValueByPath(fromObject, [
      "segmentationClasses"
    ]);
    if (fromSegmentationClasses != null) {
      setValueByPath(toObject, ["maskClasses"], fromSegmentationClasses);
    }
    const fromMaskDilation = getValueByPath(fromObject, ["maskDilation"]);
    if (fromMaskDilation != null) {
      setValueByPath(toObject, ["dilation"], fromMaskDilation);
    }
    return toObject;
  }
  function mcpServerToVertex(fromObject, _rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["name"]) !== void 0) {
      throw new Error("name parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["streamableHttpTransport"]) !== void 0) {
      throw new Error("streamableHttpTransport parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function modelFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (fromDisplayName != null) {
      setValueByPath(toObject, ["displayName"], fromDisplayName);
    }
    const fromDescription = getValueByPath(fromObject, ["description"]);
    if (fromDescription != null) {
      setValueByPath(toObject, ["description"], fromDescription);
    }
    const fromVersion = getValueByPath(fromObject, ["version"]);
    if (fromVersion != null) {
      setValueByPath(toObject, ["version"], fromVersion);
    }
    const fromTunedModelInfo = getValueByPath(fromObject, ["_self"]);
    if (fromTunedModelInfo != null) {
      setValueByPath(toObject, ["tunedModelInfo"], tunedModelInfoFromMldev(fromTunedModelInfo));
    }
    const fromInputTokenLimit = getValueByPath(fromObject, [
      "inputTokenLimit"
    ]);
    if (fromInputTokenLimit != null) {
      setValueByPath(toObject, ["inputTokenLimit"], fromInputTokenLimit);
    }
    const fromOutputTokenLimit = getValueByPath(fromObject, [
      "outputTokenLimit"
    ]);
    if (fromOutputTokenLimit != null) {
      setValueByPath(toObject, ["outputTokenLimit"], fromOutputTokenLimit);
    }
    const fromSupportedActions = getValueByPath(fromObject, [
      "supportedGenerationMethods"
    ]);
    if (fromSupportedActions != null) {
      setValueByPath(toObject, ["supportedActions"], fromSupportedActions);
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (fromTemperature != null) {
      setValueByPath(toObject, ["temperature"], fromTemperature);
    }
    const fromMaxTemperature = getValueByPath(fromObject, [
      "maxTemperature"
    ]);
    if (fromMaxTemperature != null) {
      setValueByPath(toObject, ["maxTemperature"], fromMaxTemperature);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (fromTopP != null) {
      setValueByPath(toObject, ["topP"], fromTopP);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (fromTopK != null) {
      setValueByPath(toObject, ["topK"], fromTopK);
    }
    const fromThinking = getValueByPath(fromObject, ["thinking"]);
    if (fromThinking != null) {
      setValueByPath(toObject, ["thinking"], fromThinking);
    }
    return toObject;
  }
  function modelFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (fromDisplayName != null) {
      setValueByPath(toObject, ["displayName"], fromDisplayName);
    }
    const fromDescription = getValueByPath(fromObject, ["description"]);
    if (fromDescription != null) {
      setValueByPath(toObject, ["description"], fromDescription);
    }
    const fromVersion = getValueByPath(fromObject, ["versionId"]);
    if (fromVersion != null) {
      setValueByPath(toObject, ["version"], fromVersion);
    }
    const fromEndpoints = getValueByPath(fromObject, ["deployedModels"]);
    if (fromEndpoints != null) {
      let transformedList = fromEndpoints;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return endpointFromVertex(item);
        });
      }
      setValueByPath(toObject, ["endpoints"], transformedList);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (fromLabels != null) {
      setValueByPath(toObject, ["labels"], fromLabels);
    }
    const fromTunedModelInfo = getValueByPath(fromObject, ["_self"]);
    if (fromTunedModelInfo != null) {
      setValueByPath(toObject, ["tunedModelInfo"], tunedModelInfoFromVertex(fromTunedModelInfo));
    }
    const fromDefaultCheckpointId = getValueByPath(fromObject, [
      "defaultCheckpointId"
    ]);
    if (fromDefaultCheckpointId != null) {
      setValueByPath(toObject, ["defaultCheckpointId"], fromDefaultCheckpointId);
    }
    const fromCheckpoints = getValueByPath(fromObject, ["checkpoints"]);
    if (fromCheckpoints != null) {
      let transformedList = fromCheckpoints;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["checkpoints"], transformedList);
    }
    return toObject;
  }
  function partToMldev$1(fromObject, rootObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], fromCodeExecutionResult);
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], fromExecutableCode);
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fileDataToMldev$1(fromFileData));
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], functionCallToMldev$1(fromFunctionCall));
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], blobToMldev$1(fromInlineData));
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    const fromToolCall = getValueByPath(fromObject, ["toolCall"]);
    if (fromToolCall != null) {
      setValueByPath(toObject, ["toolCall"], fromToolCall);
    }
    const fromToolResponse = getValueByPath(fromObject, ["toolResponse"]);
    if (fromToolResponse != null) {
      setValueByPath(toObject, ["toolResponse"], fromToolResponse);
    }
    const fromPartMetadata = getValueByPath(fromObject, ["partMetadata"]);
    if (fromPartMetadata != null) {
      setValueByPath(toObject, ["partMetadata"], fromPartMetadata);
    }
    return toObject;
  }
  function partToVertex$1(fromObject, rootObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], codeExecutionResultToVertex$1(fromCodeExecutionResult));
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], executableCodeToVertex$1(fromExecutableCode));
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fromFileData);
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], fromFunctionCall);
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], fromInlineData);
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    if (getValueByPath(fromObject, ["toolCall"]) !== void 0) {
      throw new Error("toolCall parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["toolResponse"]) !== void 0) {
      throw new Error("toolResponse parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["partMetadata"]) !== void 0) {
      throw new Error("partMetadata parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function productImageToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromProductImage = getValueByPath(fromObject, ["productImage"]);
    if (fromProductImage != null) {
      setValueByPath(toObject, ["image"], imageToVertex(fromProductImage));
    }
    return toObject;
  }
  function recontextImageConfigToVertex(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromNumberOfImages = getValueByPath(fromObject, [
      "numberOfImages"
    ]);
    if (parentObject !== void 0 && fromNumberOfImages != null) {
      setValueByPath(parentObject, ["parameters", "sampleCount"], fromNumberOfImages);
    }
    const fromBaseSteps = getValueByPath(fromObject, ["baseSteps"]);
    if (parentObject !== void 0 && fromBaseSteps != null) {
      setValueByPath(parentObject, ["parameters", "baseSteps"], fromBaseSteps);
    }
    const fromOutputGcsUri = getValueByPath(fromObject, ["outputGcsUri"]);
    if (parentObject !== void 0 && fromOutputGcsUri != null) {
      setValueByPath(parentObject, ["parameters", "storageUri"], fromOutputGcsUri);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (parentObject !== void 0 && fromSeed != null) {
      setValueByPath(parentObject, ["parameters", "seed"], fromSeed);
    }
    const fromSafetyFilterLevel = getValueByPath(fromObject, [
      "safetyFilterLevel"
    ]);
    if (parentObject !== void 0 && fromSafetyFilterLevel != null) {
      setValueByPath(parentObject, ["parameters", "safetySetting"], fromSafetyFilterLevel);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (parentObject !== void 0 && fromPersonGeneration != null) {
      setValueByPath(parentObject, ["parameters", "personGeneration"], fromPersonGeneration);
    }
    const fromAddWatermark = getValueByPath(fromObject, ["addWatermark"]);
    if (parentObject !== void 0 && fromAddWatermark != null) {
      setValueByPath(parentObject, ["parameters", "addWatermark"], fromAddWatermark);
    }
    const fromOutputMimeType = getValueByPath(fromObject, [
      "outputMimeType"
    ]);
    if (parentObject !== void 0 && fromOutputMimeType != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "mimeType"], fromOutputMimeType);
    }
    const fromOutputCompressionQuality = getValueByPath(fromObject, [
      "outputCompressionQuality"
    ]);
    if (parentObject !== void 0 && fromOutputCompressionQuality != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "compressionQuality"], fromOutputCompressionQuality);
    }
    const fromEnhancePrompt = getValueByPath(fromObject, [
      "enhancePrompt"
    ]);
    if (parentObject !== void 0 && fromEnhancePrompt != null) {
      setValueByPath(parentObject, ["parameters", "enhancePrompt"], fromEnhancePrompt);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    return toObject;
  }
  function recontextImageParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromSource = getValueByPath(fromObject, ["source"]);
    if (fromSource != null) {
      recontextImageSourceToVertex(fromSource, toObject);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      recontextImageConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function recontextImageResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromGeneratedImages = getValueByPath(fromObject, [
      "predictions"
    ]);
    if (fromGeneratedImages != null) {
      let transformedList = fromGeneratedImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedImageFromVertex(item);
        });
      }
      setValueByPath(toObject, ["generatedImages"], transformedList);
    }
    return toObject;
  }
  function recontextImageSourceToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (parentObject !== void 0 && fromPrompt != null) {
      setValueByPath(parentObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromPersonImage = getValueByPath(fromObject, ["personImage"]);
    if (parentObject !== void 0 && fromPersonImage != null) {
      setValueByPath(parentObject, ["instances[0]", "personImage", "image"], imageToVertex(fromPersonImage));
    }
    const fromProductImages = getValueByPath(fromObject, [
      "productImages"
    ]);
    if (parentObject !== void 0 && fromProductImages != null) {
      let transformedList = fromProductImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return productImageToVertex(item);
        });
      }
      setValueByPath(parentObject, ["instances[0]", "productImages"], transformedList);
    }
    return toObject;
  }
  function referenceImageAPIInternalToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromReferenceImage = getValueByPath(fromObject, [
      "referenceImage"
    ]);
    if (fromReferenceImage != null) {
      setValueByPath(toObject, ["referenceImage"], imageToVertex(fromReferenceImage));
    }
    const fromReferenceId = getValueByPath(fromObject, ["referenceId"]);
    if (fromReferenceId != null) {
      setValueByPath(toObject, ["referenceId"], fromReferenceId);
    }
    const fromReferenceType = getValueByPath(fromObject, [
      "referenceType"
    ]);
    if (fromReferenceType != null) {
      setValueByPath(toObject, ["referenceType"], fromReferenceType);
    }
    const fromMaskImageConfig = getValueByPath(fromObject, [
      "maskImageConfig"
    ]);
    if (fromMaskImageConfig != null) {
      setValueByPath(toObject, ["maskImageConfig"], maskReferenceConfigToVertex(fromMaskImageConfig));
    }
    const fromControlImageConfig = getValueByPath(fromObject, [
      "controlImageConfig"
    ]);
    if (fromControlImageConfig != null) {
      setValueByPath(toObject, ["controlImageConfig"], controlReferenceConfigToVertex(fromControlImageConfig));
    }
    const fromStyleImageConfig = getValueByPath(fromObject, [
      "styleImageConfig"
    ]);
    if (fromStyleImageConfig != null) {
      setValueByPath(toObject, ["styleImageConfig"], fromStyleImageConfig);
    }
    const fromSubjectImageConfig = getValueByPath(fromObject, [
      "subjectImageConfig"
    ]);
    if (fromSubjectImageConfig != null) {
      setValueByPath(toObject, ["subjectImageConfig"], fromSubjectImageConfig);
    }
    return toObject;
  }
  function safetyAttributesFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromCategories = getValueByPath(fromObject, [
      "safetyAttributes",
      "categories"
    ]);
    if (fromCategories != null) {
      setValueByPath(toObject, ["categories"], fromCategories);
    }
    const fromScores = getValueByPath(fromObject, [
      "safetyAttributes",
      "scores"
    ]);
    if (fromScores != null) {
      setValueByPath(toObject, ["scores"], fromScores);
    }
    const fromContentType = getValueByPath(fromObject, ["contentType"]);
    if (fromContentType != null) {
      setValueByPath(toObject, ["contentType"], fromContentType);
    }
    return toObject;
  }
  function safetyAttributesFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromCategories = getValueByPath(fromObject, [
      "safetyAttributes",
      "categories"
    ]);
    if (fromCategories != null) {
      setValueByPath(toObject, ["categories"], fromCategories);
    }
    const fromScores = getValueByPath(fromObject, [
      "safetyAttributes",
      "scores"
    ]);
    if (fromScores != null) {
      setValueByPath(toObject, ["scores"], fromScores);
    }
    const fromContentType = getValueByPath(fromObject, ["contentType"]);
    if (fromContentType != null) {
      setValueByPath(toObject, ["contentType"], fromContentType);
    }
    return toObject;
  }
  function safetySettingToMldev$1(fromObject, _rootObject) {
    const toObject = {};
    const fromCategory = getValueByPath(fromObject, ["category"]);
    if (fromCategory != null) {
      setValueByPath(toObject, ["category"], fromCategory);
    }
    if (getValueByPath(fromObject, ["method"]) !== void 0) {
      throw new Error("method parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromThreshold = getValueByPath(fromObject, ["threshold"]);
    if (fromThreshold != null) {
      setValueByPath(toObject, ["threshold"], fromThreshold);
    }
    return toObject;
  }
  function scribbleImageToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["image"], imageToVertex(fromImage));
    }
    return toObject;
  }
  function segmentImageConfigToVertex(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromMode = getValueByPath(fromObject, ["mode"]);
    if (parentObject !== void 0 && fromMode != null) {
      setValueByPath(parentObject, ["parameters", "mode"], fromMode);
    }
    const fromMaxPredictions = getValueByPath(fromObject, [
      "maxPredictions"
    ]);
    if (parentObject !== void 0 && fromMaxPredictions != null) {
      setValueByPath(parentObject, ["parameters", "maxPredictions"], fromMaxPredictions);
    }
    const fromConfidenceThreshold = getValueByPath(fromObject, [
      "confidenceThreshold"
    ]);
    if (parentObject !== void 0 && fromConfidenceThreshold != null) {
      setValueByPath(parentObject, ["parameters", "confidenceThreshold"], fromConfidenceThreshold);
    }
    const fromMaskDilation = getValueByPath(fromObject, ["maskDilation"]);
    if (parentObject !== void 0 && fromMaskDilation != null) {
      setValueByPath(parentObject, ["parameters", "maskDilation"], fromMaskDilation);
    }
    const fromBinaryColorThreshold = getValueByPath(fromObject, [
      "binaryColorThreshold"
    ]);
    if (parentObject !== void 0 && fromBinaryColorThreshold != null) {
      setValueByPath(parentObject, ["parameters", "binaryColorThreshold"], fromBinaryColorThreshold);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    return toObject;
  }
  function segmentImageParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromSource = getValueByPath(fromObject, ["source"]);
    if (fromSource != null) {
      segmentImageSourceToVertex(fromSource, toObject);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      segmentImageConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function segmentImageResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromGeneratedMasks = getValueByPath(fromObject, ["predictions"]);
    if (fromGeneratedMasks != null) {
      let transformedList = fromGeneratedMasks;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedImageMaskFromVertex(item);
        });
      }
      setValueByPath(toObject, ["generatedMasks"], transformedList);
    }
    return toObject;
  }
  function segmentImageSourceToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    const fromPrompt = getValueByPath(fromObject, ["prompt"]);
    if (parentObject !== void 0 && fromPrompt != null) {
      setValueByPath(parentObject, ["instances[0]", "prompt"], fromPrompt);
    }
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (parentObject !== void 0 && fromImage != null) {
      setValueByPath(parentObject, ["instances[0]", "image"], imageToVertex(fromImage));
    }
    const fromScribbleImage = getValueByPath(fromObject, [
      "scribbleImage"
    ]);
    if (parentObject !== void 0 && fromScribbleImage != null) {
      setValueByPath(parentObject, ["instances[0]", "scribble"], scribbleImageToVertex(fromScribbleImage));
    }
    return toObject;
  }
  function toolConfigToMldev(fromObject, rootObject) {
    const toObject = {};
    const fromRetrievalConfig = getValueByPath(fromObject, [
      "retrievalConfig"
    ]);
    if (fromRetrievalConfig != null) {
      setValueByPath(toObject, ["retrievalConfig"], fromRetrievalConfig);
    }
    const fromFunctionCallingConfig = getValueByPath(fromObject, [
      "functionCallingConfig"
    ]);
    if (fromFunctionCallingConfig != null) {
      setValueByPath(toObject, ["functionCallingConfig"], functionCallingConfigToMldev(fromFunctionCallingConfig));
    }
    const fromIncludeServerSideToolInvocations = getValueByPath(fromObject, ["includeServerSideToolInvocations"]);
    if (fromIncludeServerSideToolInvocations != null) {
      setValueByPath(toObject, ["includeServerSideToolInvocations"], fromIncludeServerSideToolInvocations);
    }
    return toObject;
  }
  function toolConfigToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromRetrievalConfig = getValueByPath(fromObject, [
      "retrievalConfig"
    ]);
    if (fromRetrievalConfig != null) {
      setValueByPath(toObject, ["retrievalConfig"], fromRetrievalConfig);
    }
    const fromFunctionCallingConfig = getValueByPath(fromObject, [
      "functionCallingConfig"
    ]);
    if (fromFunctionCallingConfig != null) {
      setValueByPath(toObject, ["functionCallingConfig"], fromFunctionCallingConfig);
    }
    if (getValueByPath(fromObject, ["includeServerSideToolInvocations"]) !== void 0) {
      throw new Error("includeServerSideToolInvocations parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function toolToMldev$1(fromObject, rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["retrieval"]) !== void 0) {
      throw new Error("retrieval parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    const fromFileSearch = getValueByPath(fromObject, ["fileSearch"]);
    if (fromFileSearch != null) {
      setValueByPath(toObject, ["fileSearch"], fromFileSearch);
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], googleSearchToMldev$1(fromGoogleSearch));
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], googleMapsToMldev$1(fromGoogleMaps));
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    if (getValueByPath(fromObject, ["enterpriseWebSearch"]) !== void 0) {
      throw new Error("enterpriseWebSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    if (getValueByPath(fromObject, ["parallelAiSearch"]) !== void 0) {
      throw new Error("parallelAiSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function toolToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromRetrieval = getValueByPath(fromObject, ["retrieval"]);
    if (fromRetrieval != null) {
      setValueByPath(toObject, ["retrieval"], fromRetrieval);
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    if (getValueByPath(fromObject, ["fileSearch"]) !== void 0) {
      throw new Error("fileSearch parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], fromGoogleSearch);
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], fromGoogleMaps);
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    const fromEnterpriseWebSearch = getValueByPath(fromObject, [
      "enterpriseWebSearch"
    ]);
    if (fromEnterpriseWebSearch != null) {
      setValueByPath(toObject, ["enterpriseWebSearch"], fromEnterpriseWebSearch);
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    const fromParallelAiSearch = getValueByPath(fromObject, [
      "parallelAiSearch"
    ]);
    if (fromParallelAiSearch != null) {
      setValueByPath(toObject, ["parallelAiSearch"], fromParallelAiSearch);
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return mcpServerToVertex(item);
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function tunedModelInfoFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromBaseModel = getValueByPath(fromObject, ["baseModel"]);
    if (fromBaseModel != null) {
      setValueByPath(toObject, ["baseModel"], fromBaseModel);
    }
    const fromCreateTime = getValueByPath(fromObject, ["createTime"]);
    if (fromCreateTime != null) {
      setValueByPath(toObject, ["createTime"], fromCreateTime);
    }
    const fromUpdateTime = getValueByPath(fromObject, ["updateTime"]);
    if (fromUpdateTime != null) {
      setValueByPath(toObject, ["updateTime"], fromUpdateTime);
    }
    return toObject;
  }
  function tunedModelInfoFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromBaseModel = getValueByPath(fromObject, [
      "labels",
      "google-vertex-llm-tuning-base-model-id"
    ]);
    if (fromBaseModel != null) {
      setValueByPath(toObject, ["baseModel"], fromBaseModel);
    }
    const fromCreateTime = getValueByPath(fromObject, ["createTime"]);
    if (fromCreateTime != null) {
      setValueByPath(toObject, ["createTime"], fromCreateTime);
    }
    const fromUpdateTime = getValueByPath(fromObject, ["updateTime"]);
    if (fromUpdateTime != null) {
      setValueByPath(toObject, ["updateTime"], fromUpdateTime);
    }
    return toObject;
  }
  function updateModelConfigToMldev(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromDisplayName);
    }
    const fromDescription = getValueByPath(fromObject, ["description"]);
    if (parentObject !== void 0 && fromDescription != null) {
      setValueByPath(parentObject, ["description"], fromDescription);
    }
    const fromDefaultCheckpointId = getValueByPath(fromObject, [
      "defaultCheckpointId"
    ]);
    if (parentObject !== void 0 && fromDefaultCheckpointId != null) {
      setValueByPath(parentObject, ["defaultCheckpointId"], fromDefaultCheckpointId);
    }
    return toObject;
  }
  function updateModelConfigToVertex(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromDisplayName);
    }
    const fromDescription = getValueByPath(fromObject, ["description"]);
    if (parentObject !== void 0 && fromDescription != null) {
      setValueByPath(parentObject, ["description"], fromDescription);
    }
    const fromDefaultCheckpointId = getValueByPath(fromObject, [
      "defaultCheckpointId"
    ]);
    if (parentObject !== void 0 && fromDefaultCheckpointId != null) {
      setValueByPath(parentObject, ["defaultCheckpointId"], fromDefaultCheckpointId);
    }
    return toObject;
  }
  function updateModelParametersToMldev(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "name"], tModel(apiClient, fromModel));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      updateModelConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function updateModelParametersToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      updateModelConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function upscaleImageAPIConfigInternalToVertex(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromOutputGcsUri = getValueByPath(fromObject, ["outputGcsUri"]);
    if (parentObject !== void 0 && fromOutputGcsUri != null) {
      setValueByPath(parentObject, ["parameters", "storageUri"], fromOutputGcsUri);
    }
    const fromSafetyFilterLevel = getValueByPath(fromObject, [
      "safetyFilterLevel"
    ]);
    if (parentObject !== void 0 && fromSafetyFilterLevel != null) {
      setValueByPath(parentObject, ["parameters", "safetySetting"], fromSafetyFilterLevel);
    }
    const fromPersonGeneration = getValueByPath(fromObject, [
      "personGeneration"
    ]);
    if (parentObject !== void 0 && fromPersonGeneration != null) {
      setValueByPath(parentObject, ["parameters", "personGeneration"], fromPersonGeneration);
    }
    const fromIncludeRaiReason = getValueByPath(fromObject, [
      "includeRaiReason"
    ]);
    if (parentObject !== void 0 && fromIncludeRaiReason != null) {
      setValueByPath(parentObject, ["parameters", "includeRaiReason"], fromIncludeRaiReason);
    }
    const fromOutputMimeType = getValueByPath(fromObject, [
      "outputMimeType"
    ]);
    if (parentObject !== void 0 && fromOutputMimeType != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "mimeType"], fromOutputMimeType);
    }
    const fromOutputCompressionQuality = getValueByPath(fromObject, [
      "outputCompressionQuality"
    ]);
    if (parentObject !== void 0 && fromOutputCompressionQuality != null) {
      setValueByPath(parentObject, ["parameters", "outputOptions", "compressionQuality"], fromOutputCompressionQuality);
    }
    const fromEnhanceInputImage = getValueByPath(fromObject, [
      "enhanceInputImage"
    ]);
    if (parentObject !== void 0 && fromEnhanceInputImage != null) {
      setValueByPath(parentObject, ["parameters", "upscaleConfig", "enhanceInputImage"], fromEnhanceInputImage);
    }
    const fromImagePreservationFactor = getValueByPath(fromObject, [
      "imagePreservationFactor"
    ]);
    if (parentObject !== void 0 && fromImagePreservationFactor != null) {
      setValueByPath(parentObject, ["parameters", "upscaleConfig", "imagePreservationFactor"], fromImagePreservationFactor);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    const fromNumberOfImages = getValueByPath(fromObject, [
      "numberOfImages"
    ]);
    if (parentObject !== void 0 && fromNumberOfImages != null) {
      setValueByPath(parentObject, ["parameters", "sampleCount"], fromNumberOfImages);
    }
    const fromMode = getValueByPath(fromObject, ["mode"]);
    if (parentObject !== void 0 && fromMode != null) {
      setValueByPath(parentObject, ["parameters", "mode"], fromMode);
    }
    return toObject;
  }
  function upscaleImageAPIParametersInternalToVertex(apiClient, fromObject, rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["_url", "model"], tModel(apiClient, fromModel));
    }
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["instances[0]", "image"], imageToVertex(fromImage));
    }
    const fromUpscaleFactor = getValueByPath(fromObject, [
      "upscaleFactor"
    ]);
    if (fromUpscaleFactor != null) {
      setValueByPath(toObject, ["parameters", "upscaleConfig", "upscaleFactor"], fromUpscaleFactor);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      upscaleImageAPIConfigInternalToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function upscaleImageResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromGeneratedImages = getValueByPath(fromObject, [
      "predictions"
    ]);
    if (fromGeneratedImages != null) {
      let transformedList = fromGeneratedImages;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return generatedImageFromVertex(item);
        });
      }
      setValueByPath(toObject, ["generatedImages"], transformedList);
    }
    return toObject;
  }
  function videoFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromUri = getValueByPath(fromObject, ["uri"]);
    if (fromUri != null) {
      setValueByPath(toObject, ["uri"], fromUri);
    }
    const fromVideoBytes = getValueByPath(fromObject, ["encodedVideo"]);
    if (fromVideoBytes != null) {
      setValueByPath(toObject, ["videoBytes"], tBytes(fromVideoBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["encoding"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function videoFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromUri = getValueByPath(fromObject, ["gcsUri"]);
    if (fromUri != null) {
      setValueByPath(toObject, ["uri"], fromUri);
    }
    const fromVideoBytes = getValueByPath(fromObject, [
      "bytesBase64Encoded"
    ]);
    if (fromVideoBytes != null) {
      setValueByPath(toObject, ["videoBytes"], tBytes(fromVideoBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function videoGenerationMaskToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["_self"], imageToVertex(fromImage));
    }
    const fromMaskMode = getValueByPath(fromObject, ["maskMode"]);
    if (fromMaskMode != null) {
      setValueByPath(toObject, ["maskMode"], fromMaskMode);
    }
    return toObject;
  }
  function videoGenerationReferenceImageToMldev(fromObject, rootObject) {
    const toObject = {};
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["image"], imageToMldev(fromImage));
    }
    const fromReferenceType = getValueByPath(fromObject, [
      "referenceType"
    ]);
    if (fromReferenceType != null) {
      setValueByPath(toObject, ["referenceType"], fromReferenceType);
    }
    return toObject;
  }
  function videoGenerationReferenceImageToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromImage = getValueByPath(fromObject, ["image"]);
    if (fromImage != null) {
      setValueByPath(toObject, ["image"], imageToVertex(fromImage));
    }
    const fromReferenceType = getValueByPath(fromObject, [
      "referenceType"
    ]);
    if (fromReferenceType != null) {
      setValueByPath(toObject, ["referenceType"], fromReferenceType);
    }
    return toObject;
  }
  function videoToMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromUri = getValueByPath(fromObject, ["uri"]);
    if (fromUri != null) {
      setValueByPath(toObject, ["uri"], fromUri);
    }
    const fromVideoBytes = getValueByPath(fromObject, ["videoBytes"]);
    if (fromVideoBytes != null) {
      setValueByPath(toObject, ["encodedVideo"], tBytes(fromVideoBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["encoding"], fromMimeType);
    }
    return toObject;
  }
  function videoToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromUri = getValueByPath(fromObject, ["uri"]);
    if (fromUri != null) {
      setValueByPath(toObject, ["gcsUri"], fromUri);
    }
    const fromVideoBytes = getValueByPath(fromObject, ["videoBytes"]);
    if (fromVideoBytes != null) {
      setValueByPath(toObject, ["bytesBase64Encoded"], tBytes(fromVideoBytes));
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function createFileSearchStoreConfigToMldev(apiClient, fromObject, parentObject) {
    const toObject = {};
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromDisplayName);
    }
    const fromEmbeddingModel = getValueByPath(fromObject, [
      "embeddingModel"
    ]);
    if (parentObject !== void 0 && fromEmbeddingModel != null) {
      setValueByPath(parentObject, ["embeddingModel"], tModel(apiClient, fromEmbeddingModel));
    }
    return toObject;
  }
  function createFileSearchStoreParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createFileSearchStoreConfigToMldev(apiClient, fromConfig, toObject);
    }
    return toObject;
  }
  function deleteFileSearchStoreConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromForce = getValueByPath(fromObject, ["force"]);
    if (parentObject !== void 0 && fromForce != null) {
      setValueByPath(parentObject, ["_query", "force"], fromForce);
    }
    return toObject;
  }
  function deleteFileSearchStoreParametersToMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      deleteFileSearchStoreConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function getFileSearchStoreParametersToMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    return toObject;
  }
  function importFileConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromCustomMetadata = getValueByPath(fromObject, [
      "customMetadata"
    ]);
    if (parentObject !== void 0 && fromCustomMetadata != null) {
      let transformedList = fromCustomMetadata;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(parentObject, ["customMetadata"], transformedList);
    }
    const fromChunkingConfig = getValueByPath(fromObject, [
      "chunkingConfig"
    ]);
    if (parentObject !== void 0 && fromChunkingConfig != null) {
      setValueByPath(parentObject, ["chunkingConfig"], fromChunkingConfig);
    }
    return toObject;
  }
  function importFileOperationFromMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromResponse = getValueByPath(fromObject, ["response"]);
    if (fromResponse != null) {
      setValueByPath(toObject, ["response"], importFileResponseFromMldev(fromResponse));
    }
    return toObject;
  }
  function importFileParametersToMldev(fromObject) {
    const toObject = {};
    const fromFileSearchStoreName = getValueByPath(fromObject, [
      "fileSearchStoreName"
    ]);
    if (fromFileSearchStoreName != null) {
      setValueByPath(toObject, ["_url", "file_search_store_name"], fromFileSearchStoreName);
    }
    const fromFileName = getValueByPath(fromObject, ["fileName"]);
    if (fromFileName != null) {
      setValueByPath(toObject, ["fileName"], fromFileName);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      importFileConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function importFileResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromParent = getValueByPath(fromObject, ["parent"]);
    if (fromParent != null) {
      setValueByPath(toObject, ["parent"], fromParent);
    }
    const fromDocumentName = getValueByPath(fromObject, ["documentName"]);
    if (fromDocumentName != null) {
      setValueByPath(toObject, ["documentName"], fromDocumentName);
    }
    return toObject;
  }
  function listFileSearchStoresConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    return toObject;
  }
  function listFileSearchStoresParametersToMldev(fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listFileSearchStoresConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function listFileSearchStoresResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromFileSearchStores = getValueByPath(fromObject, [
      "fileSearchStores"
    ]);
    if (fromFileSearchStores != null) {
      let transformedList = fromFileSearchStores;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["fileSearchStores"], transformedList);
    }
    return toObject;
  }
  function uploadToFileSearchStoreConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (parentObject !== void 0 && fromMimeType != null) {
      setValueByPath(parentObject, ["mimeType"], fromMimeType);
    }
    const fromDisplayName = getValueByPath(fromObject, ["displayName"]);
    if (parentObject !== void 0 && fromDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromDisplayName);
    }
    const fromCustomMetadata = getValueByPath(fromObject, [
      "customMetadata"
    ]);
    if (parentObject !== void 0 && fromCustomMetadata != null) {
      let transformedList = fromCustomMetadata;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(parentObject, ["customMetadata"], transformedList);
    }
    const fromChunkingConfig = getValueByPath(fromObject, [
      "chunkingConfig"
    ]);
    if (parentObject !== void 0 && fromChunkingConfig != null) {
      setValueByPath(parentObject, ["chunkingConfig"], fromChunkingConfig);
    }
    return toObject;
  }
  function uploadToFileSearchStoreParametersToMldev(fromObject) {
    const toObject = {};
    const fromFileSearchStoreName = getValueByPath(fromObject, [
      "fileSearchStoreName"
    ]);
    if (fromFileSearchStoreName != null) {
      setValueByPath(toObject, ["_url", "file_search_store_name"], fromFileSearchStoreName);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      uploadToFileSearchStoreConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function uploadToFileSearchStoreResumableResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  var CONTENT_TYPE_HEADER = "Content-Type";
  var SERVER_TIMEOUT_HEADER = "X-Server-Timeout";
  var USER_AGENT_HEADER = "User-Agent";
  var GOOGLE_API_CLIENT_HEADER = "x-goog-api-client";
  var SDK_VERSION = "2.9.0";
  var LIBRARY_LABEL = `google-genai-sdk/${SDK_VERSION}`;
  var VERTEX_AI_API_DEFAULT_VERSION = "v1beta1";
  var GOOGLE_AI_API_DEFAULT_VERSION = "v1beta";
  var MULTI_REGIONAL_LOCATIONS = /* @__PURE__ */ new Set(["us", "eu"]);
  var DEFAULT_RETRY_ATTEMPTS = 5;
  var DEFAULT_RETRY_HTTP_STATUS_CODES = [
    408,
    // Request timeout
    429,
    // Too many requests
    500,
    // Internal server error
    502,
    // Bad gateway
    503,
    // Service unavailable
    504
    // Gateway timeout
  ];
  var ApiClient = class {
    constructor(opts) {
      var _a2, _b, _c;
      this.clientOptions = Object.assign({}, opts);
      this.customBaseUrl = (_a2 = opts.httpOptions) === null || _a2 === void 0 ? void 0 : _a2.baseUrl;
      if (this.clientOptions.vertexai) {
        if (this.clientOptions.project && this.clientOptions.location) {
          this.clientOptions.apiKey = void 0;
        } else if (this.clientOptions.apiKey) {
          this.clientOptions.project = void 0;
          this.clientOptions.location = void 0;
        }
      }
      const initHttpOptions = {};
      if (this.clientOptions.vertexai) {
        if (!this.clientOptions.location && !this.clientOptions.apiKey && !this.customBaseUrl) {
          this.clientOptions.location = "global";
        }
        const hasSufficientAuth = this.clientOptions.project && this.clientOptions.location || this.clientOptions.apiKey;
        if (!hasSufficientAuth && !this.customBaseUrl) {
          throw new Error("Authentication is not set up. Please provide either a project and location, or an API key, or a custom base URL.");
        }
        const hasConstructorAuth = opts.project && opts.location || !!opts.apiKey;
        if (this.customBaseUrl && !hasConstructorAuth) {
          initHttpOptions.baseUrl = this.customBaseUrl;
          this.clientOptions.project = void 0;
          this.clientOptions.location = void 0;
        } else if (this.clientOptions.apiKey || this.clientOptions.location === "global") {
          initHttpOptions.baseUrl = "https://aiplatform.googleapis.com/";
        } else if (this.clientOptions.project && this.clientOptions.location && MULTI_REGIONAL_LOCATIONS.has(this.clientOptions.location)) {
          initHttpOptions.baseUrl = `https://aiplatform.${this.clientOptions.location}.rep.googleapis.com/`;
        } else if (this.clientOptions.project && this.clientOptions.location) {
          initHttpOptions.baseUrl = `https://${this.clientOptions.location}-aiplatform.googleapis.com/`;
        }
        initHttpOptions.apiVersion = (_b = this.clientOptions.apiVersion) !== null && _b !== void 0 ? _b : VERTEX_AI_API_DEFAULT_VERSION;
      } else {
        if (!this.clientOptions.apiKey) {
          console.warn("API key should be set when using the Gemini API.");
        }
        initHttpOptions.apiVersion = (_c = this.clientOptions.apiVersion) !== null && _c !== void 0 ? _c : GOOGLE_AI_API_DEFAULT_VERSION;
        initHttpOptions.baseUrl = `https://generativelanguage.googleapis.com/`;
      }
      initHttpOptions.headers = this.getDefaultHeaders();
      this.clientOptions.httpOptions = initHttpOptions;
      if (opts.httpOptions) {
        this.clientOptions.httpOptions = this.patchHttpOptions(initHttpOptions, opts.httpOptions);
      }
    }
    isVertexAI() {
      var _a2;
      return (_a2 = this.clientOptions.vertexai) !== null && _a2 !== void 0 ? _a2 : false;
    }
    getProject() {
      return this.clientOptions.project;
    }
    getLocation() {
      return this.clientOptions.location;
    }
    getCustomBaseUrl() {
      return this.customBaseUrl;
    }
    async getAuthHeaders() {
      const headers = new Headers();
      await this.clientOptions.auth.addAuthHeaders(headers);
      return headers;
    }
    getApiVersion() {
      if (this.clientOptions.httpOptions && this.clientOptions.httpOptions.apiVersion !== void 0) {
        return this.clientOptions.httpOptions.apiVersion;
      }
      throw new Error("API version is not set.");
    }
    getBaseUrl() {
      if (this.clientOptions.httpOptions && this.clientOptions.httpOptions.baseUrl !== void 0) {
        return this.clientOptions.httpOptions.baseUrl;
      }
      throw new Error("Base URL is not set.");
    }
    getRequestUrl() {
      return this.getRequestUrlInternal(this.clientOptions.httpOptions);
    }
    getHeaders() {
      if (this.clientOptions.httpOptions && this.clientOptions.httpOptions.headers !== void 0) {
        return this.clientOptions.httpOptions.headers;
      } else {
        throw new Error("Headers are not set.");
      }
    }
    getRequestUrlInternal(httpOptions) {
      if (!httpOptions || httpOptions.baseUrl === void 0 || httpOptions.apiVersion === void 0) {
        throw new Error("HTTP options are not correctly set.");
      }
      const baseUrl = httpOptions.baseUrl.endsWith("/") ? httpOptions.baseUrl.slice(0, -1) : httpOptions.baseUrl;
      const urlElement = [baseUrl];
      if (httpOptions.apiVersion && httpOptions.apiVersion !== "") {
        urlElement.push(httpOptions.apiVersion);
      }
      return urlElement.join("/");
    }
    getBaseResourcePath() {
      return `projects/${this.clientOptions.project}/locations/${this.clientOptions.location}`;
    }
    getApiKey() {
      return this.clientOptions.apiKey;
    }
    getWebsocketBaseUrl() {
      const baseUrl = this.getBaseUrl();
      const urlParts = new URL(baseUrl);
      urlParts.protocol = urlParts.protocol == "http:" ? "ws" : "wss";
      return urlParts.toString();
    }
    setBaseUrl(url) {
      if (this.clientOptions.httpOptions) {
        this.clientOptions.httpOptions.baseUrl = url;
      } else {
        throw new Error("HTTP options are not correctly set.");
      }
    }
    constructUrl(path, httpOptions, prependProjectLocation) {
      const urlElement = [this.getRequestUrlInternal(httpOptions)];
      if (prependProjectLocation) {
        urlElement.push(this.getBaseResourcePath());
      }
      if (path !== "") {
        urlElement.push(path);
      }
      const url = new URL(`${urlElement.join("/")}`);
      return url;
    }
    shouldPrependVertexProjectPath(request, httpOptions) {
      if (httpOptions.baseUrl && httpOptions.baseUrlResourceScope === ResourceScope.COLLECTION) {
        return false;
      }
      if (this.clientOptions.apiKey) {
        return false;
      }
      if (!this.clientOptions.vertexai) {
        return false;
      }
      if (request.path.startsWith("projects/")) {
        return false;
      }
      if (request.httpMethod === "GET" && request.path.startsWith("publishers/google/models")) {
        return false;
      }
      return true;
    }
    async request(request) {
      let patchedHttpOptions = this.clientOptions.httpOptions;
      if (request.httpOptions) {
        patchedHttpOptions = this.patchHttpOptions(this.clientOptions.httpOptions, request.httpOptions);
      }
      const prependProjectLocation = this.shouldPrependVertexProjectPath(request, patchedHttpOptions);
      const url = this.constructUrl(request.path, patchedHttpOptions, prependProjectLocation);
      if (request.queryParams) {
        for (const [key, value] of Object.entries(request.queryParams)) {
          url.searchParams.append(key, String(value));
        }
      }
      let requestInit = {};
      if (request.httpMethod === "GET") {
        if (request.body && request.body !== "{}") {
          throw new Error("Request body should be empty for GET request, but got non empty request body");
        }
      } else {
        requestInit.body = request.body;
      }
      requestInit = await this.includeExtraHttpOptionsToRequestInit(requestInit, patchedHttpOptions, url.toString(), request.abortSignal);
      return this.unaryApiCall(url, requestInit, request.httpMethod);
    }
    patchHttpOptions(baseHttpOptions, requestHttpOptions) {
      const patchedHttpOptions = JSON.parse(JSON.stringify(baseHttpOptions));
      for (const [key, value] of Object.entries(requestHttpOptions)) {
        if (typeof value === "object") {
          patchedHttpOptions[key] = Object.assign(Object.assign({}, patchedHttpOptions[key]), value);
        } else if (value !== void 0) {
          patchedHttpOptions[key] = value;
        }
      }
      return patchedHttpOptions;
    }
    async requestStream(request) {
      let patchedHttpOptions = this.clientOptions.httpOptions;
      if (request.httpOptions) {
        patchedHttpOptions = this.patchHttpOptions(this.clientOptions.httpOptions, request.httpOptions);
      }
      const prependProjectLocation = this.shouldPrependVertexProjectPath(request, patchedHttpOptions);
      const url = this.constructUrl(request.path, patchedHttpOptions, prependProjectLocation);
      if (!url.searchParams.has("alt") || url.searchParams.get("alt") !== "sse") {
        url.searchParams.set("alt", "sse");
      }
      let requestInit = {};
      requestInit.body = request.body;
      requestInit = await this.includeExtraHttpOptionsToRequestInit(requestInit, patchedHttpOptions, url.toString(), request.abortSignal);
      return this.streamApiCall(url, requestInit, request.httpMethod);
    }
    async includeExtraHttpOptionsToRequestInit(requestInit, httpOptions, url, abortSignal) {
      if (httpOptions && httpOptions.timeout || abortSignal) {
        const abortController = new AbortController();
        const signal = abortController.signal;
        if (httpOptions.timeout && (httpOptions === null || httpOptions === void 0 ? void 0 : httpOptions.timeout) > 0) {
          const dispatcherSymbol = Symbol.for("undici.globalDispatcher.1");
          const globalDispatcher = globalThis[dispatcherSymbol];
          if (globalDispatcher) {
            const symbols = Object.getOwnPropertySymbols(globalDispatcher);
            for (const sym of symbols) {
              const desc = sym.description;
              if ((desc === null || desc === void 0 ? void 0 : desc.includes("headers timeout")) || (desc === null || desc === void 0 ? void 0 : desc.includes("body timeout"))) {
                const currentTimeout = globalDispatcher[sym];
                if (typeof currentTimeout === "number") {
                  globalDispatcher[sym] = Math.max(currentTimeout, httpOptions.timeout);
                }
              }
            }
          }
          const timeoutHandle = setTimeout(() => abortController.abort(), httpOptions.timeout);
          if (timeoutHandle && typeof timeoutHandle.unref === "function") {
            timeoutHandle.unref();
          }
        }
        if (abortSignal) {
          abortSignal.addEventListener("abort", () => {
            abortController.abort();
          });
        }
        requestInit.signal = signal;
      }
      if (httpOptions && httpOptions.extraBody !== null) {
        includeExtraBodyToRequestInit(requestInit, httpOptions.extraBody);
      }
      requestInit.headers = await this.getHeadersInternal(httpOptions, url);
      return requestInit;
    }
    async unaryApiCall(url, requestInit, httpMethod) {
      return this.apiCall(url.toString(), Object.assign(Object.assign({}, requestInit), { method: httpMethod })).then(async (response) => {
        await throwErrorIfNotOK(response);
        return new HttpResponse(response);
      }).catch((e) => {
        if (e instanceof Error) {
          throw e;
        } else {
          throw new Error(`exception ${e} sending request`, { cause: e });
        }
      });
    }
    async streamApiCall(url, requestInit, httpMethod) {
      return this.apiCall(url.toString(), Object.assign(Object.assign({}, requestInit), { method: httpMethod })).then(async (response) => {
        await throwErrorIfNotOK(response);
        return this.processStreamResponse(response);
      }).catch((e) => {
        if (e instanceof Error) {
          throw e;
        } else {
          throw new Error(`exception ${e} sending request`, { cause: e });
        }
      });
    }
    processStreamResponse(response) {
      return __asyncGenerator(this, arguments, function* processStreamResponse_1() {
        var _a2;
        const reader = (_a2 = response === null || response === void 0 ? void 0 : response.body) === null || _a2 === void 0 ? void 0 : _a2.getReader();
        const decoder = new TextDecoder("utf-8");
        if (!reader) {
          throw new Error("Response body is empty");
        }
        try {
          let buffer = "";
          const dataPrefix = "data:";
          const delimiters = ["\n\n", "\r\r", "\r\n\r\n"];
          while (true) {
            const { done, value } = yield __await(reader.read());
            if (done) {
              if (buffer.trim().length > 0) {
                throw new Error("Incomplete JSON segment at the end");
              }
              break;
            }
            const chunkString = decoder.decode(value, { stream: true });
            try {
              const chunkJson = JSON.parse(chunkString);
              if ("error" in chunkJson) {
                const errorJson = JSON.parse(JSON.stringify(chunkJson["error"]));
                const status = errorJson["status"];
                const code = errorJson["code"];
                const errorMessage = `got status: ${status}. ${JSON.stringify(chunkJson)}`;
                if (code >= 400 && code < 600) {
                  const apiError = new ApiError({
                    message: errorMessage,
                    status: code
                  });
                  throw apiError;
                }
              }
            } catch (e) {
              const error = e;
              if (error.name === "ApiError") {
                throw e;
              }
            }
            buffer += chunkString;
            let delimiterIndex = -1;
            let delimiterLength = 0;
            while (true) {
              delimiterIndex = -1;
              delimiterLength = 0;
              for (const delimiter of delimiters) {
                const index = buffer.indexOf(delimiter);
                if (index !== -1 && (delimiterIndex === -1 || index < delimiterIndex)) {
                  delimiterIndex = index;
                  delimiterLength = delimiter.length;
                }
              }
              if (delimiterIndex === -1) {
                break;
              }
              const eventString = buffer.substring(0, delimiterIndex);
              buffer = buffer.substring(delimiterIndex + delimiterLength);
              const trimmedEvent = eventString.trim();
              if (trimmedEvent.startsWith(dataPrefix)) {
                const processedChunkString = trimmedEvent.substring(dataPrefix.length).trim();
                try {
                  const partialResponse = new Response(processedChunkString, {
                    headers: response === null || response === void 0 ? void 0 : response.headers,
                    status: response === null || response === void 0 ? void 0 : response.status,
                    statusText: response === null || response === void 0 ? void 0 : response.statusText
                  });
                  yield yield __await(new HttpResponse(partialResponse));
                } catch (e) {
                  throw new Error(`exception parsing stream chunk ${processedChunkString}. ${e}`);
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      });
    }
    async apiCall(url, requestInit) {
      var _a2;
      if (!this.clientOptions.httpOptions || !this.clientOptions.httpOptions.retryOptions) {
        return fetch(url, requestInit);
      }
      const retryOptions = this.clientOptions.httpOptions.retryOptions;
      const runFetch = async () => {
        const response = await fetch(url, requestInit);
        if (response.ok) {
          return response;
        }
        if (DEFAULT_RETRY_HTTP_STATUS_CODES.includes(response.status)) {
          throw new Error(`Retryable HTTP Error: ${response.statusText}`);
        }
        throw new import_p_retry.AbortError(`Non-retryable exception ${response.statusText} sending request`);
      };
      return (0, import_p_retry.default)(runFetch, {
        // Retry attempts is one less than the number of total attempts.
        retries: ((_a2 = retryOptions.attempts) !== null && _a2 !== void 0 ? _a2 : DEFAULT_RETRY_ATTEMPTS) - 1
      });
    }
    getDefaultHeaders() {
      const headers = {};
      const versionHeaderValue = LIBRARY_LABEL + " " + this.clientOptions.userAgentExtra;
      headers[USER_AGENT_HEADER] = versionHeaderValue;
      headers[GOOGLE_API_CLIENT_HEADER] = versionHeaderValue;
      headers[CONTENT_TYPE_HEADER] = "application/json";
      return headers;
    }
    async getHeadersInternal(httpOptions, url) {
      const headers = new Headers();
      if (httpOptions && httpOptions.headers) {
        for (const [key, value] of Object.entries(httpOptions.headers)) {
          headers.append(key, value);
        }
      }
      if ((httpOptions === null || httpOptions === void 0 ? void 0 : httpOptions.timeout) && httpOptions.timeout > 0) {
        headers.append(SERVER_TIMEOUT_HEADER, String(Math.ceil(httpOptions.timeout / 1e3)));
      }
      await this.clientOptions.auth.addAuthHeaders(headers, url);
      return headers;
    }
    getFileName(file) {
      var _a2;
      let fileName = "";
      if (typeof file === "string") {
        fileName = file.replace(/[/\\]+$/, "");
        fileName = (_a2 = fileName.split(/[/\\]/).pop()) !== null && _a2 !== void 0 ? _a2 : "";
      }
      return fileName;
    }
    /**
     * Uploads a file asynchronously using Gemini API only, this is not supported
     * in Vertex AI.
     *
     * @param file The string path to the file to be uploaded or a Blob object.
     * @param config Optional parameters specified in the `UploadFileConfig`
     *     interface. @see {@link types.UploadFileConfig}
     * @return A promise that resolves to a `File` object.
     * @throws An error if called on a Vertex AI client.
     * @throws An error if the `mimeType` is not provided and can not be inferred,
     */
    async uploadFile(file, config) {
      var _a2;
      const fileToUpload = {};
      if (config != null) {
        fileToUpload.mimeType = config.mimeType;
        fileToUpload.name = config.name;
        fileToUpload.displayName = config.displayName;
      }
      if (fileToUpload.name && !fileToUpload.name.startsWith("files/")) {
        fileToUpload.name = `files/${fileToUpload.name}`;
      }
      const uploader = this.clientOptions.uploader;
      const fileStat = await uploader.stat(file);
      fileToUpload.sizeBytes = String(fileStat.size);
      const mimeType = (_a2 = config === null || config === void 0 ? void 0 : config.mimeType) !== null && _a2 !== void 0 ? _a2 : fileStat.type;
      if (mimeType === void 0 || mimeType === "") {
        throw new Error("Can not determine mimeType. Please provide mimeType in the config.");
      }
      fileToUpload.mimeType = mimeType;
      const body = {
        file: fileToUpload
      };
      const fileName = this.getFileName(file);
      const path = formatMap("upload/v1beta/files", body["_url"]);
      const uploadUrl = await this.fetchUploadUrl(path, fileToUpload.sizeBytes, fileToUpload.mimeType, fileName, body, config === null || config === void 0 ? void 0 : config.httpOptions);
      return uploader.upload(file, uploadUrl, this);
    }
    /**
     * Uploads a file to a given file search store asynchronously using Gemini API only, this is not supported
     * in Vertex AI.
     *
     * @param fileSearchStoreName The name of the file search store to upload the file to.
     * @param file The string path to the file to be uploaded or a Blob object.
     * @param config Optional parameters specified in the `UploadFileConfig`
     *     interface. @see {@link UploadFileConfig}
     * @return A promise that resolves to a `File` object.
     * @throws An error if called on a Vertex AI client.
     * @throws An error if the `mimeType` is not provided and can not be inferred,
     */
    async uploadFileToFileSearchStore(fileSearchStoreName, file, config) {
      var _a2;
      const uploader = this.clientOptions.uploader;
      const fileStat = await uploader.stat(file);
      const sizeBytes = String(fileStat.size);
      const mimeType = (_a2 = config === null || config === void 0 ? void 0 : config.mimeType) !== null && _a2 !== void 0 ? _a2 : fileStat.type;
      if (mimeType === void 0 || mimeType === "") {
        throw new Error("Can not determine mimeType. Please provide mimeType in the config.");
      }
      const path = `upload/v1beta/${fileSearchStoreName}:uploadToFileSearchStore`;
      const fileName = this.getFileName(file);
      const body = {};
      if (config != null) {
        uploadToFileSearchStoreConfigToMldev(config, body);
      }
      const uploadUrl = await this.fetchUploadUrl(path, sizeBytes, mimeType, fileName, body, config === null || config === void 0 ? void 0 : config.httpOptions);
      return uploader.uploadToFileSearchStore(file, uploadUrl, this);
    }
    /**
     * Downloads a file asynchronously to the specified path.
     *
     * @params params - The parameters for the download request, see {@link
     * types.DownloadFileParameters}
     */
    async downloadFile(params) {
      const downloader = this.clientOptions.downloader;
      await downloader.download(params, this);
    }
    async fetchUploadUrl(path, sizeBytes, mimeType, fileName, body, configHttpOptions) {
      var _a2;
      let httpOptions = {};
      if (configHttpOptions) {
        httpOptions = configHttpOptions;
      } else {
        httpOptions = {
          apiVersion: "",
          // api-version is set in the path.
          headers: Object.assign({ "Content-Type": "application/json", "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": `${sizeBytes}`, "X-Goog-Upload-Header-Content-Type": `${mimeType}` }, fileName ? { "X-Goog-Upload-File-Name": fileName } : {})
        };
      }
      const httpResponse = await this.request({
        path,
        body: JSON.stringify(body),
        httpMethod: "POST",
        httpOptions
      });
      if (!httpResponse || !(httpResponse === null || httpResponse === void 0 ? void 0 : httpResponse.headers)) {
        throw new Error("Server did not return an HttpResponse or the returned HttpResponse did not have headers.");
      }
      const uploadUrl = (_a2 = httpResponse === null || httpResponse === void 0 ? void 0 : httpResponse.headers) === null || _a2 === void 0 ? void 0 : _a2["x-goog-upload-url"];
      if (uploadUrl === void 0) {
        throw new Error("Failed to get upload url. Server did not return the x-google-upload-url in the headers");
      }
      return uploadUrl;
    }
  };
  async function throwErrorIfNotOK(response) {
    var _a2;
    if (response === void 0) {
      throw new Error("response is undefined");
    }
    if (!response.ok) {
      const status = response.status;
      let errorBody;
      if ((_a2 = response.headers.get("content-type")) === null || _a2 === void 0 ? void 0 : _a2.includes("application/json")) {
        errorBody = await response.json();
      } else {
        errorBody = {
          error: {
            message: await response.text(),
            code: response.status,
            status: response.statusText
          }
        };
      }
      const errorMessage = JSON.stringify(errorBody);
      if (status >= 400 && status < 600) {
        const apiError = new ApiError({
          message: errorMessage,
          status
        });
        throw apiError;
      }
      throw new Error(errorMessage);
    }
  }
  function includeExtraBodyToRequestInit(requestInit, extraBody) {
    if (!extraBody || Object.keys(extraBody).length === 0) {
      return;
    }
    if (requestInit.body instanceof Blob) {
      console.warn("includeExtraBodyToRequestInit: extraBody provided but current request body is a Blob. extraBody will be ignored as merging is not supported for Blob bodies.");
      return;
    }
    let currentBodyObject = {};
    if (typeof requestInit.body === "string" && requestInit.body.length > 0) {
      try {
        const parsedBody = JSON.parse(requestInit.body);
        if (typeof parsedBody === "object" && parsedBody !== null && !Array.isArray(parsedBody)) {
          currentBodyObject = parsedBody;
        } else {
          console.warn("includeExtraBodyToRequestInit: Original request body is valid JSON but not a non-array object. Skip applying extraBody to the request body.");
          return;
        }
      } catch (e) {
        console.warn("includeExtraBodyToRequestInit: Original request body is not valid JSON. Skip applying extraBody to the request body.");
        return;
      }
    }
    function deepMerge(target, source) {
      const output = Object.assign({}, target);
      for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          const sourceValue = source[key];
          const targetValue = output[key];
          if (sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue) && targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)) {
            output[key] = deepMerge(targetValue, sourceValue);
          } else {
            if (targetValue && sourceValue && typeof targetValue !== typeof sourceValue) {
              console.warn(`includeExtraBodyToRequestInit:deepMerge: Type mismatch for key "${key}". Original type: ${typeof targetValue}, New type: ${typeof sourceValue}. Overwriting.`);
            }
            output[key] = sourceValue;
          }
        }
      }
      return output;
    }
    const mergedBody = deepMerge(currentBodyObject, extraBody);
    requestInit.body = JSON.stringify(mergedBody);
  }
  var MCP_LABEL = "mcp_used/unknown";
  var hasMcpToolUsageFromMcpToTool = false;
  function hasMcpToolUsage(tools) {
    for (const tool of tools) {
      if (isMcpCallableTool(tool)) {
        return true;
      }
      if (typeof tool === "object" && "inputSchema" in tool) {
        return true;
      }
    }
    return hasMcpToolUsageFromMcpToTool;
  }
  function setMcpUsageHeader(headers) {
    var _a2;
    const existingHeader = (_a2 = headers[GOOGLE_API_CLIENT_HEADER]) !== null && _a2 !== void 0 ? _a2 : "";
    headers[GOOGLE_API_CLIENT_HEADER] = (existingHeader + ` ${MCP_LABEL}`).trimStart();
  }
  function isMcpCallableTool(object) {
    return object !== null && typeof object === "object" && object instanceof McpCallableTool;
  }
  function listAllTools(mcpClient_1) {
    return __asyncGenerator(this, arguments, function* listAllTools_1(mcpClient, maxTools = 100) {
      let cursor = void 0;
      let numTools = 0;
      while (numTools < maxTools) {
        const t2 = yield __await(mcpClient.listTools({ cursor }));
        for (const tool of t2.tools) {
          yield yield __await(tool);
          numTools++;
        }
        if (!t2.nextCursor) {
          break;
        }
        cursor = t2.nextCursor;
      }
    });
  }
  var McpCallableTool = class _McpCallableTool {
    constructor(mcpClients = [], config) {
      this.mcpTools = [];
      this.functionNameToMcpClient = {};
      this.mcpClients = mcpClients;
      this.config = config;
    }
    /**
     * Creates a McpCallableTool.
     */
    static create(mcpClients, config) {
      return new _McpCallableTool(mcpClients, config);
    }
    /**
     * Validates the function names are not duplicate and initialize the function
     * name to MCP client mapping.
     *
     * @throws {Error} if the MCP tools from the MCP clients have duplicate tool
     *     names.
     */
    async initialize() {
      var _a2, e_1, _b, _c;
      if (this.mcpTools.length > 0) {
        return;
      }
      const functionMap = {};
      const mcpTools = [];
      for (const mcpClient of this.mcpClients) {
        try {
          for (var _d = true, _e = (e_1 = void 0, __asyncValues(listAllTools(mcpClient))), _f; _f = await _e.next(), _a2 = _f.done, !_a2; _d = true) {
            _c = _f.value;
            _d = false;
            const mcpTool = _c;
            mcpTools.push(mcpTool);
            const mcpToolName = mcpTool.name;
            if (functionMap[mcpToolName]) {
              throw new Error(`Duplicate function name ${mcpToolName} found in MCP tools. Please ensure function names are unique.`);
            }
            functionMap[mcpToolName] = mcpClient;
          }
        } catch (e_1_1) {
          e_1 = { error: e_1_1 };
        } finally {
          try {
            if (!_d && !_a2 && (_b = _e.return)) await _b.call(_e);
          } finally {
            if (e_1) throw e_1.error;
          }
        }
      }
      this.mcpTools = mcpTools;
      this.functionNameToMcpClient = functionMap;
    }
    async tool() {
      await this.initialize();
      return mcpToolsToGeminiTool(this.mcpTools, this.config);
    }
    async callTool(functionCalls) {
      await this.initialize();
      const functionCallResponseParts = [];
      for (const functionCall of functionCalls) {
        if (functionCall.name in this.functionNameToMcpClient) {
          const mcpClient = this.functionNameToMcpClient[functionCall.name];
          let requestOptions = void 0;
          if (this.config.timeout) {
            requestOptions = {
              timeout: this.config.timeout
            };
          }
          const callToolResponse = await mcpClient.callTool(
            {
              name: functionCall.name,
              arguments: functionCall.args
            },
            // Set the result schema to undefined to allow MCP to rely on the
            // default schema.
            void 0,
            requestOptions
          );
          functionCallResponseParts.push({
            functionResponse: {
              name: functionCall.name,
              response: callToolResponse.isError ? { error: callToolResponse } : callToolResponse
            }
          });
        }
      }
      return functionCallResponseParts;
    }
  };
  async function handleWebSocketMessage$1(apiClient, onmessage, event) {
    const serverMessage = new LiveMusicServerMessage();
    let data;
    if (event.data instanceof Blob) {
      data = JSON.parse(await event.data.text());
    } else {
      data = JSON.parse(event.data);
    }
    Object.assign(serverMessage, data);
    onmessage(serverMessage);
  }
  var LiveMusic = class {
    constructor(apiClient, auth, webSocketFactory) {
      this.apiClient = apiClient;
      this.auth = auth;
      this.webSocketFactory = webSocketFactory;
    }
    /**
         Establishes a connection to the specified model and returns a
         LiveMusicSession object representing that connection.
    
         @experimental
    
         @remarks
    
         @param params - The parameters for establishing a connection to the model.
         @return A live session.
    
         @example
         ```ts
         let model = 'models/lyria-realtime-exp';
         const session = await ai.live.music.connect({
           model: model,
           callbacks: {
             onmessage: (e: MessageEvent) => {
               console.log('Received message from the server: %s\n', debug(e.data));
             },
             onerror: (e: ErrorEvent) => {
               console.log('Error occurred: %s\n', debug(e.error));
             },
             onclose: (e: CloseEvent) => {
               console.log('Connection closed.');
             },
           },
         });
         ```
        */
    async connect(params) {
      var _a2, _b;
      if (this.apiClient.isVertexAI()) {
        throw new Error("Live music is not supported for Vertex AI.");
      }
      console.warn("Live music generation is experimental and may change in future versions.");
      const websocketBaseUrl = this.apiClient.getWebsocketBaseUrl();
      const apiVersion = this.apiClient.getApiVersion();
      const headers = mapToHeaders$1(this.apiClient.getDefaultHeaders());
      const apiKey = this.apiClient.getApiKey();
      const url = `${websocketBaseUrl}/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateMusic?key=${apiKey}`;
      let onopenResolve = () => {
      };
      const onopenPromise = new Promise((resolve) => {
        onopenResolve = resolve;
      });
      const callbacks = params.callbacks;
      const onopenAwaitedCallback = function() {
        onopenResolve({});
      };
      const apiClient = this.apiClient;
      const websocketCallbacks = {
        onopen: onopenAwaitedCallback,
        onmessage: (event) => {
          void handleWebSocketMessage$1(apiClient, callbacks.onmessage, event);
        },
        onerror: (_a2 = callbacks === null || callbacks === void 0 ? void 0 : callbacks.onerror) !== null && _a2 !== void 0 ? _a2 : function(e) {
        },
        onclose: (_b = callbacks === null || callbacks === void 0 ? void 0 : callbacks.onclose) !== null && _b !== void 0 ? _b : function(e) {
        }
      };
      const conn = this.webSocketFactory.create(url, headersToMap$1(headers), websocketCallbacks);
      conn.connect();
      await onopenPromise;
      const model = tModel(this.apiClient, params.model);
      const setup = { model };
      const clientMessage = { setup };
      conn.send(JSON.stringify(clientMessage));
      return new LiveMusicSession(conn, this.apiClient);
    }
  };
  var LiveMusicSession = class {
    constructor(conn, apiClient) {
      this.conn = conn;
      this.apiClient = apiClient;
    }
    /**
        Sets inputs to steer music generation. Updates the session's current
        weighted prompts.
    
        @param params - Contains one property, `weightedPrompts`.
    
          - `weightedPrompts` to send to the model; weights are normalized to
            sum to 1.0.
    
        @experimental
       */
    async setWeightedPrompts(params) {
      if (!params.weightedPrompts || Object.keys(params.weightedPrompts).length === 0) {
        throw new Error("Weighted prompts must be set and contain at least one entry.");
      }
      const clientContent = liveMusicSetWeightedPromptsParametersToMldev(params);
      this.conn.send(JSON.stringify({ clientContent }));
    }
    /**
        Sets a configuration to the model. Updates the session's current
        music generation config.
    
        @param params - Contains one property, `musicGenerationConfig`.
    
          - `musicGenerationConfig` to set in the model. Passing an empty or
        undefined config to the model will reset the config to defaults.
    
        @experimental
       */
    async setMusicGenerationConfig(params) {
      if (!params.musicGenerationConfig) {
        params.musicGenerationConfig = {};
      }
      const setConfigParameters = liveMusicSetConfigParametersToMldev(params);
      this.conn.send(JSON.stringify(setConfigParameters));
    }
    sendPlaybackControl(playbackControl) {
      const clientMessage = { playbackControl };
      this.conn.send(JSON.stringify(clientMessage));
    }
    /**
     * Start the music stream.
     *
     * @experimental
     */
    play() {
      this.sendPlaybackControl(LiveMusicPlaybackControl.PLAY);
    }
    /**
     * Temporarily halt the music stream. Use `play` to resume from the current
     * position.
     *
     * @experimental
     */
    pause() {
      this.sendPlaybackControl(LiveMusicPlaybackControl.PAUSE);
    }
    /**
     * Stop the music stream and reset the state. Retains the current prompts
     * and config.
     *
     * @experimental
     */
    stop() {
      this.sendPlaybackControl(LiveMusicPlaybackControl.STOP);
    }
    /**
     * Resets the context of the music generation without stopping it.
     * Retains the current prompts and config.
     *
     * @experimental
     */
    resetContext() {
      this.sendPlaybackControl(LiveMusicPlaybackControl.RESET_CONTEXT);
    }
    /**
         Terminates the WebSocket connection.
    
         @experimental
       */
    close() {
      this.conn.close();
    }
  };
  function headersToMap$1(headers) {
    const headerMap = {};
    headers.forEach((value, key) => {
      headerMap[key] = value;
    });
    return headerMap;
  }
  function mapToHeaders$1(map) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(map)) {
      headers.append(key, value);
    }
    return headers;
  }
  var FUNCTION_RESPONSE_REQUIRES_ID = "FunctionResponse request must have an `id` field from the response of a ToolCall.FunctionalCalls in Google AI.";
  async function handleWebSocketMessage(apiClient, onmessage, event) {
    const serverMessage = new LiveServerMessage();
    let jsonData;
    if (event.data instanceof Blob) {
      jsonData = await event.data.text();
    } else if (event.data instanceof ArrayBuffer) {
      jsonData = new TextDecoder().decode(event.data);
    } else {
      jsonData = event.data;
    }
    const data = JSON.parse(jsonData);
    if (apiClient.isVertexAI()) {
      const resp = liveServerMessageFromVertex(data);
      Object.assign(serverMessage, resp);
    } else {
      const resp = data;
      Object.assign(serverMessage, resp);
    }
    onmessage(serverMessage);
  }
  var Live = class {
    constructor(apiClient, auth, webSocketFactory) {
      this.apiClient = apiClient;
      this.auth = auth;
      this.webSocketFactory = webSocketFactory;
      this.music = new LiveMusic(this.apiClient, this.auth, this.webSocketFactory);
    }
    /**
         Establishes a connection to the specified model with the given
         configuration and returns a Session object representing that connection.
    
         @experimental Built-in MCP support is an experimental feature, may change in
         future versions.
    
         @remarks
    
         @param params - The parameters for establishing a connection to the model.
         @return A live session.
    
         @example
         ```ts
         let model: string;
         if (GOOGLE_GENAI_USE_VERTEXAI) {
           model = 'gemini-2.0-flash-live-preview-04-09';
         } else {
           model = 'gemini-live-2.5-flash-preview';
         }
         const session = await ai.live.connect({
           model: model,
           config: {
             responseModalities: [Modality.AUDIO],
           },
           callbacks: {
             onopen: () => {
               console.log('Connected to the socket.');
             },
             onmessage: (e: MessageEvent) => {
               console.log('Received message from the server: %s\n', debug(e.data));
             },
             onerror: (e: ErrorEvent) => {
               console.log('Error occurred: %s\n', debug(e.error));
             },
             onclose: (e: CloseEvent) => {
               console.log('Connection closed.');
             },
           },
         });
         ```
        */
    async connect(params) {
      var _a2, _b, _c, _d, _e, _f;
      if (params.config && params.config.httpOptions) {
        throw new Error("The Live module does not support httpOptions at request-level in LiveConnectConfig yet. Please use the client-level httpOptions configuration instead.");
      }
      const websocketBaseUrl = this.apiClient.getWebsocketBaseUrl();
      const apiVersion = this.apiClient.getApiVersion();
      let url;
      const clientHeaders = this.apiClient.getHeaders();
      if (params.config && params.config.tools && hasMcpToolUsage(params.config.tools)) {
        setMcpUsageHeader(clientHeaders);
      }
      const headers = mapToHeaders(clientHeaders);
      if (this.apiClient.isVertexAI()) {
        const project = this.apiClient.getProject();
        const location2 = this.apiClient.getLocation();
        const apiKey = this.apiClient.getApiKey();
        const hasStandardAuth = !!project && !!location2 || !!apiKey;
        if (this.apiClient.getCustomBaseUrl() && !hasStandardAuth) {
          url = websocketBaseUrl;
        } else {
          url = `${websocketBaseUrl}/ws/google.cloud.aiplatform.${apiVersion}.LlmBidiService/BidiGenerateContent`;
          await this.auth.addAuthHeaders(headers, url);
        }
      } else {
        const apiKey = this.apiClient.getApiKey();
        let method = "BidiGenerateContent";
        let keyName = "key";
        if (apiKey === null || apiKey === void 0 ? void 0 : apiKey.startsWith("auth_tokens/")) {
          console.warn("Warning: Ephemeral token support is experimental and may change in future versions.");
          if (apiVersion !== "v1alpha") {
            console.warn("Warning: The SDK's ephemeral token support is in v1alpha only. Please use const ai = new GoogleGenAI({apiKey: token.name, httpOptions: { apiVersion: 'v1alpha' }}); before session connection.");
          }
          method = "BidiGenerateContentConstrained";
          keyName = "access_token";
        }
        url = `${websocketBaseUrl}/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.${method}?${keyName}=${apiKey}`;
      }
      let onopenResolve = () => {
      };
      const onopenPromise = new Promise((resolve) => {
        onopenResolve = resolve;
      });
      const callbacks = params.callbacks;
      const onopenAwaitedCallback = function() {
        var _a3;
        (_a3 = callbacks === null || callbacks === void 0 ? void 0 : callbacks.onopen) === null || _a3 === void 0 ? void 0 : _a3.call(callbacks);
        onopenResolve({});
      };
      const apiClient = this.apiClient;
      const websocketCallbacks = {
        onopen: onopenAwaitedCallback,
        onmessage: (event) => {
          void handleWebSocketMessage(apiClient, callbacks.onmessage, event);
        },
        onerror: (_a2 = callbacks === null || callbacks === void 0 ? void 0 : callbacks.onerror) !== null && _a2 !== void 0 ? _a2 : function(e) {
        },
        onclose: (_b = callbacks === null || callbacks === void 0 ? void 0 : callbacks.onclose) !== null && _b !== void 0 ? _b : function(e) {
        }
      };
      const conn = this.webSocketFactory.create(url, headersToMap(headers), websocketCallbacks);
      conn.connect();
      await onopenPromise;
      let transformedModel = tModel(this.apiClient, params.model);
      if (this.apiClient.isVertexAI() && transformedModel.startsWith("publishers/")) {
        const project = this.apiClient.getProject();
        const location2 = this.apiClient.getLocation();
        if (project && location2) {
          transformedModel = `projects/${project}/locations/${location2}/` + transformedModel;
        }
      }
      let clientMessage = {};
      if (this.apiClient.isVertexAI() && ((_c = params.config) === null || _c === void 0 ? void 0 : _c.responseModalities) === void 0) {
        if (params.config === void 0) {
          params.config = { responseModalities: [Modality.AUDIO] };
        } else {
          params.config.responseModalities = [Modality.AUDIO];
        }
      }
      if ((_d = params.config) === null || _d === void 0 ? void 0 : _d.generationConfig) {
        console.warn("Setting `LiveConnectConfig.generation_config` is deprecated, please set the fields on `LiveConnectConfig` directly. This will become an error in a future version (not before Q3 2025).");
      }
      const inputTools = (_f = (_e = params.config) === null || _e === void 0 ? void 0 : _e.tools) !== null && _f !== void 0 ? _f : [];
      const convertedTools = [];
      for (const tool of inputTools) {
        if (this.isCallableTool(tool)) {
          const callableTool = tool;
          convertedTools.push(await callableTool.tool());
        } else {
          convertedTools.push(tool);
        }
      }
      if (convertedTools.length > 0) {
        params.config.tools = convertedTools;
      }
      const liveConnectParameters = {
        model: transformedModel,
        config: params.config,
        callbacks: params.callbacks
      };
      if (this.apiClient.isVertexAI()) {
        clientMessage = liveConnectParametersToVertex(this.apiClient, liveConnectParameters);
      } else {
        clientMessage = liveConnectParametersToMldev(this.apiClient, liveConnectParameters);
      }
      delete clientMessage["config"];
      conn.send(JSON.stringify(clientMessage));
      return new Session(conn, this.apiClient);
    }
    // TODO: b/416041229 - Abstract this method to a common place.
    isCallableTool(tool) {
      return "callTool" in tool && typeof tool.callTool === "function";
    }
  };
  var defaultLiveSendClientContentParamerters = {
    turnComplete: true
  };
  var Session = class {
    constructor(conn, apiClient) {
      this.conn = conn;
      this.apiClient = apiClient;
    }
    tLiveClientContent(apiClient, params) {
      if (params.turns !== null && params.turns !== void 0) {
        let contents = [];
        try {
          contents = tContents(params.turns);
          if (!apiClient.isVertexAI()) {
            contents = contents.map((item) => contentToMldev$1(item));
          }
        } catch (_a2) {
          throw new Error(`Failed to parse client content "turns", type: '${typeof params.turns}'`);
        }
        return {
          clientContent: { turns: contents, turnComplete: params.turnComplete }
        };
      }
      return {
        clientContent: { turnComplete: params.turnComplete }
      };
    }
    tLiveClienttToolResponse(apiClient, params) {
      let functionResponses = [];
      if (params.functionResponses == null) {
        throw new Error("functionResponses is required.");
      }
      if (!Array.isArray(params.functionResponses)) {
        functionResponses = [params.functionResponses];
      } else {
        functionResponses = params.functionResponses;
      }
      if (functionResponses.length === 0) {
        throw new Error("functionResponses is required.");
      }
      for (const functionResponse of functionResponses) {
        if (typeof functionResponse !== "object" || functionResponse === null || !("name" in functionResponse) || !("response" in functionResponse)) {
          throw new Error(`Could not parse function response, type '${typeof functionResponse}'.`);
        }
        if (!apiClient.isVertexAI() && !("id" in functionResponse)) {
          throw new Error(FUNCTION_RESPONSE_REQUIRES_ID);
        }
      }
      const clientMessage = {
        toolResponse: { "functionResponses": functionResponses }
      };
      return clientMessage;
    }
    /**
        Send a message over the established connection.
    
        @param params - Contains two **optional** properties, `turns` and
            `turnComplete`.
    
          - `turns` will be converted to a `Content[]`
          - `turnComplete: true` [default] indicates that you are done sending
            content and expect a response. If `turnComplete: false`, the server
            will wait for additional messages before starting generation.
    
        @experimental
    
        @remarks
        There are two ways to send messages to the live API:
        `sendClientContent` and `sendRealtimeInput`.
    
        `sendClientContent` messages are added to the model context **in order**.
        Having a conversation using `sendClientContent` messages is roughly
        equivalent to using the `Chat.sendMessageStream`, except that the state of
        the `chat` history is stored on the API server instead of locally.
    
        Because of `sendClientContent`'s order guarantee, the model cannot respons
        as quickly to `sendClientContent` messages as to `sendRealtimeInput`
        messages. This makes the biggest difference when sending objects that have
        significant preprocessing time (typically images).
    
        The `sendClientContent` message sends a `Content[]`
        which has more options than the `Blob` sent by `sendRealtimeInput`.
    
        So the main use-cases for `sendClientContent` over `sendRealtimeInput` are:
    
        - Sending anything that can't be represented as a `Blob` (text,
        `sendClientContent({turns="Hello?"}`)).
        - Managing turns when not using audio input and voice activity detection.
          (`sendClientContent({turnComplete:true})` or the short form
        `sendClientContent()`)
        - Prefilling a conversation context
          ```
          sendClientContent({
              turns: [
                Content({role:user, parts:...}),
                Content({role:user, parts:...}),
                ...
              ]
          })
          ```
        @experimental
       */
    sendClientContent(params) {
      params = Object.assign(Object.assign({}, defaultLiveSendClientContentParamerters), params);
      const clientMessage = this.tLiveClientContent(this.apiClient, params);
      this.conn.send(JSON.stringify(clientMessage));
    }
    /**
        Send a realtime message over the established connection.
    
        @param params - Contains one property, `media`.
    
          - `media` will be converted to a `Blob`
    
        @experimental
    
        @remarks
        Use `sendRealtimeInput` for realtime audio chunks and video frames (images).
    
        With `sendRealtimeInput` the api will respond to audio automatically
        based on voice activity detection (VAD).
    
        `sendRealtimeInput` is optimized for responsivness at the expense of
        deterministic ordering guarantees. Audio and video tokens are to the
        context when they become available.
    
        Note: The Call signature expects a `Blob` object, but only a subset
        of audio and image mimetypes are allowed.
       */
    sendRealtimeInput(params) {
      let clientMessage = {};
      if (this.apiClient.isVertexAI()) {
        clientMessage = {
          "realtimeInput": liveSendRealtimeInputParametersToVertex(params)
        };
      } else {
        clientMessage = {
          "realtimeInput": liveSendRealtimeInputParametersToMldev(params)
        };
      }
      this.conn.send(JSON.stringify(clientMessage));
    }
    /**
        Send a function response message over the established connection.
    
        @param params - Contains property `functionResponses`.
    
          - `functionResponses` will be converted to a `functionResponses[]`
    
        @remarks
        Use `sendFunctionResponse` to reply to `LiveServerToolCall` from the server.
    
        Use {@link types.LiveConnectConfig#tools} to configure the callable functions.
    
        @experimental
       */
    sendToolResponse(params) {
      if (params.functionResponses == null) {
        throw new Error("Tool response parameters are required.");
      }
      const clientMessage = this.tLiveClienttToolResponse(this.apiClient, params);
      this.conn.send(JSON.stringify(clientMessage));
    }
    /**
         Terminates the WebSocket connection.
    
         @experimental
    
         @example
         ```ts
         let model: string;
         if (GOOGLE_GENAI_USE_VERTEXAI) {
           model = 'gemini-2.0-flash-live-preview-04-09';
         } else {
           model = 'gemini-live-2.5-flash-preview';
         }
         const session = await ai.live.connect({
           model: model,
           config: {
             responseModalities: [Modality.AUDIO],
           }
         });
    
         session.close();
         ```
       */
    close() {
      this.conn.close();
    }
  };
  function headersToMap(headers) {
    const headerMap = {};
    headers.forEach((value, key) => {
      headerMap[key] = value;
    });
    return headerMap;
  }
  function mapToHeaders(map) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(map)) {
      headers.append(key, value);
    }
    return headers;
  }
  var DEFAULT_MAX_REMOTE_CALLS = 10;
  function shouldDisableAfc(config) {
    var _a2, _b, _c;
    if ((_a2 = config === null || config === void 0 ? void 0 : config.automaticFunctionCalling) === null || _a2 === void 0 ? void 0 : _a2.disable) {
      return true;
    }
    let callableToolsPresent = false;
    for (const tool of (_b = config === null || config === void 0 ? void 0 : config.tools) !== null && _b !== void 0 ? _b : []) {
      if (isCallableTool(tool)) {
        callableToolsPresent = true;
        break;
      }
    }
    if (!callableToolsPresent) {
      return true;
    }
    const maxCalls = (_c = config === null || config === void 0 ? void 0 : config.automaticFunctionCalling) === null || _c === void 0 ? void 0 : _c.maximumRemoteCalls;
    if (maxCalls && (maxCalls < 0 || !Number.isInteger(maxCalls)) || maxCalls == 0) {
      console.warn("Invalid maximumRemoteCalls value provided for automatic function calling. Disabled automatic function calling. Please provide a valid integer value greater than 0. maximumRemoteCalls provided:", maxCalls);
      return true;
    }
    return false;
  }
  function isCallableTool(tool) {
    return "callTool" in tool && typeof tool.callTool === "function";
  }
  function hasCallableTools(params) {
    var _a2, _b, _c;
    return (_c = (_b = (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.tools) === null || _b === void 0 ? void 0 : _b.some((tool) => isCallableTool(tool))) !== null && _c !== void 0 ? _c : false;
  }
  function findAfcIncompatibleToolIndexes(params) {
    var _a2;
    const afcIncompatibleToolIndexes = [];
    if (!((_a2 = params === null || params === void 0 ? void 0 : params.config) === null || _a2 === void 0 ? void 0 : _a2.tools)) {
      return afcIncompatibleToolIndexes;
    }
    params.config.tools.forEach((tool, index) => {
      if (isCallableTool(tool)) {
        return;
      }
      const geminiTool = tool;
      if (geminiTool.functionDeclarations && geminiTool.functionDeclarations.length > 0) {
        afcIncompatibleToolIndexes.push(index);
      }
    });
    return afcIncompatibleToolIndexes;
  }
  function shouldAppendAfcHistory(config) {
    var _a2;
    return !((_a2 = config === null || config === void 0 ? void 0 : config.automaticFunctionCalling) === null || _a2 === void 0 ? void 0 : _a2.ignoreCallHistory);
  }
  var Models = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
      this.embedContent = async (params) => {
        if (!this.apiClient.isVertexAI()) {
          const isGeminiEmbedding2Model = params.model.includes("gemini-embedding-2");
          if (isGeminiEmbedding2Model) {
            params.contents = tContents(params.contents);
          }
          return await this.embedContentInternal(params);
        }
        const isVertexEmbedContentModel = params.model.includes("gemini") && params.model !== "gemini-embedding-001" || params.model.includes("maas");
        if (isVertexEmbedContentModel) {
          const contents = tContents(params.contents);
          if (contents.length > 1) {
            throw new Error("The embedContent API for this model only supports one content at a time.");
          }
          const paramsPrivate = Object.assign(Object.assign({}, params), { content: contents[0], embeddingApiType: EmbeddingApiType.EMBED_CONTENT });
          return await this.embedContentInternal(paramsPrivate);
        } else {
          const paramsPrivate = Object.assign(Object.assign({}, params), { embeddingApiType: EmbeddingApiType.PREDICT });
          return await this.embedContentInternal(paramsPrivate);
        }
      };
      this.generateContent = async (params) => {
        var _a2, _b, _c, _d, _e;
        const transformedParams = await this.processParamsMaybeAddMcpUsage(params);
        this.maybeMoveToResponseJsonSchem(params);
        if (!hasCallableTools(params) || shouldDisableAfc(params.config)) {
          return await this.generateContentInternal(transformedParams);
        }
        const incompatibleToolIndexes = findAfcIncompatibleToolIndexes(params);
        if (incompatibleToolIndexes.length > 0) {
          const formattedIndexes = incompatibleToolIndexes.map((index) => `tools[${index}]`).join(", ");
          throw new Error(`Automatic function calling with CallableTools (or MCP objects) and basic FunctionDeclarations is not yet supported. Incompatible tools found at ${formattedIndexes}.`);
        }
        let response;
        let functionResponseContent;
        const automaticFunctionCallingHistory = tContents(transformedParams.contents);
        const maxRemoteCalls = (_c = (_b = (_a2 = transformedParams.config) === null || _a2 === void 0 ? void 0 : _a2.automaticFunctionCalling) === null || _b === void 0 ? void 0 : _b.maximumRemoteCalls) !== null && _c !== void 0 ? _c : DEFAULT_MAX_REMOTE_CALLS;
        let remoteCalls = 0;
        while (remoteCalls < maxRemoteCalls) {
          response = await this.generateContentInternal(transformedParams);
          if (!response.functionCalls || response.functionCalls.length === 0) {
            break;
          }
          const responseContent = response.candidates[0].content;
          const functionResponseParts = [];
          for (const tool of (_e = (_d = params.config) === null || _d === void 0 ? void 0 : _d.tools) !== null && _e !== void 0 ? _e : []) {
            if (isCallableTool(tool)) {
              const callableTool = tool;
              const parts = await callableTool.callTool(response.functionCalls);
              functionResponseParts.push(...parts);
            }
          }
          remoteCalls++;
          functionResponseContent = {
            role: "user",
            parts: functionResponseParts
          };
          transformedParams.contents = tContents(transformedParams.contents);
          transformedParams.contents.push(responseContent);
          transformedParams.contents.push(functionResponseContent);
          if (shouldAppendAfcHistory(transformedParams.config)) {
            automaticFunctionCallingHistory.push(responseContent);
            automaticFunctionCallingHistory.push(functionResponseContent);
          }
        }
        if (shouldAppendAfcHistory(transformedParams.config)) {
          response.automaticFunctionCallingHistory = automaticFunctionCallingHistory;
        }
        return response;
      };
      this.generateContentStream = async (params) => {
        var _a2, _b, _c, _d, _e;
        this.maybeMoveToResponseJsonSchem(params);
        if (shouldDisableAfc(params.config)) {
          const transformedParams = await this.processParamsMaybeAddMcpUsage(params);
          return await this.generateContentStreamInternal(transformedParams);
        }
        const incompatibleToolIndexes = findAfcIncompatibleToolIndexes(params);
        if (incompatibleToolIndexes.length > 0) {
          const formattedIndexes = incompatibleToolIndexes.map((index) => `tools[${index}]`).join(", ");
          throw new Error(`Incompatible tools found at ${formattedIndexes}. Automatic function calling with CallableTools (or MCP objects) and basic FunctionDeclarations" is not yet supported.`);
        }
        const streamFunctionCall = (_c = (_b = (_a2 = params === null || params === void 0 ? void 0 : params.config) === null || _a2 === void 0 ? void 0 : _a2.toolConfig) === null || _b === void 0 ? void 0 : _b.functionCallingConfig) === null || _c === void 0 ? void 0 : _c.streamFunctionCallArguments;
        const disableAfc = (_e = (_d = params === null || params === void 0 ? void 0 : params.config) === null || _d === void 0 ? void 0 : _d.automaticFunctionCalling) === null || _e === void 0 ? void 0 : _e.disable;
        if (streamFunctionCall && !disableAfc) {
          throw new Error("Running in streaming mode with 'streamFunctionCallArguments' enabled, this feature is not compatible with automatic function calling (AFC). Please set 'config.automaticFunctionCalling.disable' to true to disable AFC or leave 'config.toolConfig.functionCallingConfig.streamFunctionCallArguments' to be undefined or set to false to disable streaming function call arguments feature.");
        }
        return await this.processAfcStream(params);
      };
      this.generateImages = async (params) => {
        return await this.generateImagesInternal(params).then((apiResponse) => {
          var _a2;
          let positivePromptSafetyAttributes;
          const generatedImages = [];
          if (apiResponse === null || apiResponse === void 0 ? void 0 : apiResponse.generatedImages) {
            for (const generatedImage of apiResponse.generatedImages) {
              if (generatedImage && (generatedImage === null || generatedImage === void 0 ? void 0 : generatedImage.safetyAttributes) && ((_a2 = generatedImage === null || generatedImage === void 0 ? void 0 : generatedImage.safetyAttributes) === null || _a2 === void 0 ? void 0 : _a2.contentType) === "Positive Prompt") {
                positivePromptSafetyAttributes = generatedImage === null || generatedImage === void 0 ? void 0 : generatedImage.safetyAttributes;
              } else {
                generatedImages.push(generatedImage);
              }
            }
          }
          let response;
          if (positivePromptSafetyAttributes) {
            response = {
              generatedImages,
              positivePromptSafetyAttributes,
              sdkHttpResponse: apiResponse.sdkHttpResponse
            };
          } else {
            response = {
              generatedImages,
              sdkHttpResponse: apiResponse.sdkHttpResponse
            };
          }
          return response;
        });
      };
      this.list = async (params) => {
        var _a2;
        const defaultConfig = {
          queryBase: true
        };
        const actualConfig = Object.assign(Object.assign({}, defaultConfig), params === null || params === void 0 ? void 0 : params.config);
        const actualParams = {
          config: actualConfig
        };
        if (this.apiClient.isVertexAI()) {
          if (!actualParams.config.queryBase) {
            if ((_a2 = actualParams.config) === null || _a2 === void 0 ? void 0 : _a2.filter) {
              throw new Error("Filtering tuned models list is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
            } else {
              actualParams.config.filter = "labels.tune-type:*";
            }
          }
        }
        return new Pager(PagedItem.PAGED_ITEM_MODELS, (x) => this.listInternal(x), await this.listInternal(actualParams), actualParams);
      };
      this.editImage = async (params) => {
        const paramsInternal = {
          model: params.model,
          prompt: params.prompt,
          referenceImages: [],
          config: params.config
        };
        if (params.referenceImages) {
          if (params.referenceImages) {
            paramsInternal.referenceImages = params.referenceImages.map((img) => img.toReferenceImageAPI());
          }
        }
        return await this.editImageInternal(paramsInternal);
      };
      this.upscaleImage = async (params) => {
        let apiConfig = {
          numberOfImages: 1,
          mode: "upscale"
        };
        if (params.config) {
          apiConfig = Object.assign(Object.assign({}, apiConfig), params.config);
        }
        const apiParams = {
          model: params.model,
          image: params.image,
          upscaleFactor: params.upscaleFactor,
          config: apiConfig
        };
        return await this.upscaleImageInternal(apiParams);
      };
      this.generateVideos = async (params) => {
        var _a2, _b, _c, _d, _e, _f;
        if ((params.prompt || params.image || params.video) && params.source) {
          throw new Error("Source and prompt/image/video are mutually exclusive. Please only use source.");
        }
        if (!this.apiClient.isVertexAI()) {
          if (((_a2 = params.video) === null || _a2 === void 0 ? void 0 : _a2.uri) && ((_b = params.video) === null || _b === void 0 ? void 0 : _b.videoBytes)) {
            params.video = {
              uri: params.video.uri,
              mimeType: params.video.mimeType
            };
          } else if (((_d = (_c = params.source) === null || _c === void 0 ? void 0 : _c.video) === null || _d === void 0 ? void 0 : _d.uri) && ((_f = (_e = params.source) === null || _e === void 0 ? void 0 : _e.video) === null || _f === void 0 ? void 0 : _f.videoBytes)) {
            params.source.video = {
              uri: params.source.video.uri,
              mimeType: params.source.video.mimeType
            };
          }
        }
        return await this.generateVideosInternal(params);
      };
    }
    /**
     * This logic is needed for GenerateContentConfig only.
     * Previously we made GenerateContentConfig.responseSchema field to accept
     * unknown. Since v1.9.0, we switch to use backend JSON schema support.
     * To maintain backward compatibility, we move the data that was treated as
     * JSON schema from the responseSchema field to the responseJsonSchema field.
     */
    maybeMoveToResponseJsonSchem(params) {
      if (params.config && params.config.responseSchema) {
        if (!params.config.responseJsonSchema) {
          if (Object.keys(params.config.responseSchema).includes("$schema")) {
            params.config.responseJsonSchema = params.config.responseSchema;
            delete params.config.responseSchema;
          }
        }
      }
      return;
    }
    /**
     * Transforms the CallableTools in the parameters to be simply Tools, it
     * copies the params into a new object and replaces the tools, it does not
     * modify the original params. Also sets the MCP usage header if there are
     * MCP tools in the parameters.
     */
    async processParamsMaybeAddMcpUsage(params) {
      var _a2, _b, _c;
      const tools = (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.tools;
      if (!tools) {
        return params;
      }
      const transformedTools = await Promise.all(tools.map(async (tool) => {
        if (isCallableTool(tool)) {
          const callableTool = tool;
          return await callableTool.tool();
        }
        return tool;
      }));
      const newParams = {
        model: params.model,
        contents: params.contents,
        config: Object.assign(Object.assign({}, params.config), { tools: transformedTools })
      };
      newParams.config.tools = transformedTools;
      if (params.config && params.config.tools && hasMcpToolUsage(params.config.tools)) {
        const headers = (_c = (_b = params.config.httpOptions) === null || _b === void 0 ? void 0 : _b.headers) !== null && _c !== void 0 ? _c : {};
        let newHeaders = Object.assign({}, headers);
        if (Object.keys(newHeaders).length === 0) {
          newHeaders = this.apiClient.getDefaultHeaders();
        }
        setMcpUsageHeader(newHeaders);
        newParams.config.httpOptions = Object.assign(Object.assign({}, params.config.httpOptions), { headers: newHeaders });
      }
      return newParams;
    }
    async initAfcToolsMap(params) {
      var _a2, _b, _c;
      const afcTools = /* @__PURE__ */ new Map();
      for (const tool of (_b = (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.tools) !== null && _b !== void 0 ? _b : []) {
        if (isCallableTool(tool)) {
          const callableTool = tool;
          const toolDeclaration = await callableTool.tool();
          for (const declaration of (_c = toolDeclaration.functionDeclarations) !== null && _c !== void 0 ? _c : []) {
            if (!declaration.name) {
              throw new Error("Function declaration name is required.");
            }
            if (afcTools.has(declaration.name)) {
              throw new Error(`Duplicate tool declaration name: ${declaration.name}`);
            }
            afcTools.set(declaration.name, callableTool);
          }
        }
      }
      return afcTools;
    }
    async processAfcStream(params) {
      var _a2, _b, _c;
      const maxRemoteCalls = (_c = (_b = (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.automaticFunctionCalling) === null || _b === void 0 ? void 0 : _b.maximumRemoteCalls) !== null && _c !== void 0 ? _c : DEFAULT_MAX_REMOTE_CALLS;
      let wereFunctionsCalled = false;
      let remoteCallCount = 0;
      const afcToolsMap = await this.initAfcToolsMap(params);
      return function(models, afcTools, params2) {
        return __asyncGenerator(this, arguments, function* () {
          var _a3, e_1, _b2, _c2;
          var _d, _e;
          while (remoteCallCount < maxRemoteCalls) {
            if (wereFunctionsCalled) {
              remoteCallCount++;
              wereFunctionsCalled = false;
            }
            const transformedParams = yield __await(models.processParamsMaybeAddMcpUsage(params2));
            const response = yield __await(models.generateContentStreamInternal(transformedParams));
            const functionResponses = [];
            const responseContents = [];
            try {
              for (var _f = true, response_1 = (e_1 = void 0, __asyncValues(response)), response_1_1; response_1_1 = yield __await(response_1.next()), _a3 = response_1_1.done, !_a3; _f = true) {
                _c2 = response_1_1.value;
                _f = false;
                const chunk = _c2;
                yield yield __await(chunk);
                if (chunk.candidates && ((_d = chunk.candidates[0]) === null || _d === void 0 ? void 0 : _d.content)) {
                  responseContents.push(chunk.candidates[0].content);
                  for (const part of (_e = chunk.candidates[0].content.parts) !== null && _e !== void 0 ? _e : []) {
                    if (remoteCallCount < maxRemoteCalls && part.functionCall) {
                      if (!part.functionCall.name) {
                        throw new Error("Function call name was not returned by the model.");
                      }
                      if (!afcTools.has(part.functionCall.name)) {
                        throw new Error(`Automatic function calling was requested, but not all the tools the model used implement the CallableTool interface. Available tools: ${afcTools.keys()}, mising tool: ${part.functionCall.name}`);
                      } else {
                        const responseParts = yield __await(afcTools.get(part.functionCall.name).callTool([part.functionCall]));
                        functionResponses.push(...responseParts);
                      }
                    }
                  }
                }
              }
            } catch (e_1_1) {
              e_1 = { error: e_1_1 };
            } finally {
              try {
                if (!_f && !_a3 && (_b2 = response_1.return)) yield __await(_b2.call(response_1));
              } finally {
                if (e_1) throw e_1.error;
              }
            }
            if (functionResponses.length > 0) {
              wereFunctionsCalled = true;
              const typedResponseChunk = new GenerateContentResponse();
              typedResponseChunk.candidates = [
                {
                  content: {
                    role: "user",
                    parts: functionResponses
                  }
                }
              ];
              yield yield __await(typedResponseChunk);
              const newContents = [];
              newContents.push(...responseContents);
              newContents.push({
                role: "user",
                parts: functionResponses
              });
              const updatedContents = tContents(params2.contents).concat(newContents);
              params2.contents = updatedContents;
            } else {
              break;
            }
          }
        });
      }(this, afcToolsMap, params);
    }
    async generateContentInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = generateContentParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:generateContent", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = generateContentResponseFromVertex(apiResponse);
          const typedResp = new GenerateContentResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = generateContentParametersToMldev(this.apiClient, params);
        path = formatMap("{model}:generateContent", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = generateContentResponseFromMldev(apiResponse);
          const typedResp = new GenerateContentResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    async generateContentStreamInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = generateContentParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:streamGenerateContent?alt=sse", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        const apiClient = this.apiClient;
        response = apiClient.requestStream({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        });
        return response.then(function(apiResponse) {
          return __asyncGenerator(this, arguments, function* () {
            var _a3, e_2, _b2, _c2;
            try {
              for (var _d2 = true, apiResponse_1 = __asyncValues(apiResponse), apiResponse_1_1; apiResponse_1_1 = yield __await(apiResponse_1.next()), _a3 = apiResponse_1_1.done, !_a3; _d2 = true) {
                _c2 = apiResponse_1_1.value;
                _d2 = false;
                const chunk = _c2;
                const resp = generateContentResponseFromVertex(yield __await(chunk.json()), params);
                resp["sdkHttpResponse"] = {
                  headers: chunk.headers
                };
                const typedResp = new GenerateContentResponse();
                Object.assign(typedResp, resp);
                yield yield __await(typedResp);
              }
            } catch (e_2_1) {
              e_2 = { error: e_2_1 };
            } finally {
              try {
                if (!_d2 && !_a3 && (_b2 = apiResponse_1.return)) yield __await(_b2.call(apiResponse_1));
              } finally {
                if (e_2) throw e_2.error;
              }
            }
          });
        });
      } else {
        const body = generateContentParametersToMldev(this.apiClient, params);
        path = formatMap("{model}:streamGenerateContent?alt=sse", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        const apiClient = this.apiClient;
        response = apiClient.requestStream({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        });
        return response.then(function(apiResponse) {
          return __asyncGenerator(this, arguments, function* () {
            var _a3, e_3, _b2, _c2;
            try {
              for (var _d2 = true, apiResponse_2 = __asyncValues(apiResponse), apiResponse_2_1; apiResponse_2_1 = yield __await(apiResponse_2.next()), _a3 = apiResponse_2_1.done, !_a3; _d2 = true) {
                _c2 = apiResponse_2_1.value;
                _d2 = false;
                const chunk = _c2;
                const resp = generateContentResponseFromMldev(yield __await(chunk.json()), params);
                resp["sdkHttpResponse"] = {
                  headers: chunk.headers
                };
                const typedResp = new GenerateContentResponse();
                Object.assign(typedResp, resp);
                yield yield __await(typedResp);
              }
            } catch (e_3_1) {
              e_3 = { error: e_3_1 };
            } finally {
              try {
                if (!_d2 && !_a3 && (_b2 = apiResponse_2.return)) yield __await(_b2.call(apiResponse_2));
              } finally {
                if (e_3) throw e_3.error;
              }
            }
          });
        });
      }
    }
    /**
     * Calculates embeddings for the given contents. Only text is supported.
     *
     * @param params - The parameters for embedding contents.
     * @return The response from the API.
     *
     * @example
     * ```ts
     * const response = await ai.models.embedContent({
     *  model: 'text-embedding-004',
     *  contents: [
     *    'What is your name?',
     *    'What is your favorite color?',
     *  ],
     *  config: {
     *    outputDimensionality: 64,
     *  },
     * });
     * console.log(response);
     * ```
     */
    async embedContentInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = embedContentParametersPrivateToVertex(this.apiClient, params, params);
        const endpointUrl = tIsVertexEmbedContentModel(params.model) ? "{model}:embedContent" : "{model}:predict";
        path = formatMap(endpointUrl, body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = embedContentResponseFromVertex(apiResponse, params);
          const typedResp = new EmbedContentResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = embedContentParametersPrivateToMldev(this.apiClient, params);
        path = formatMap("{model}:batchEmbedContents", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = embedContentResponseFromMldev(apiResponse);
          const typedResp = new EmbedContentResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Private method for generating images.
     */
    async generateImagesInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = generateImagesParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:predict", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = generateImagesResponseFromVertex(apiResponse);
          const typedResp = new GenerateImagesResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = generateImagesParametersToMldev(this.apiClient, params);
        path = formatMap("{model}:predict", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = generateImagesResponseFromMldev(apiResponse);
          const typedResp = new GenerateImagesResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Private method for editing an image.
     */
    async editImageInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = editImageParametersInternalToVertex(this.apiClient, params);
        path = formatMap("{model}:predict", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = editImageResponseFromVertex(apiResponse);
          const typedResp = new EditImageResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
    /**
     * Private method for upscaling an image.
     */
    async upscaleImageInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = upscaleImageAPIParametersInternalToVertex(this.apiClient, params);
        path = formatMap("{model}:predict", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = upscaleImageResponseFromVertex(apiResponse);
          const typedResp = new UpscaleImageResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
    /**
     * Recontextualizes an image.
     *
     * There is one type of recontextualization currently supported:
     * 1) Virtual Try-On: Generate images of persons modeling fashion products.
     *
     * @param params - The parameters for recontextualizing an image.
     * @return The response from the API.
     *
     * @example
     * ```ts
     * const response = await ai.models.recontextImage({
     *  model: 'virtual-try-on-001',
     *  source: {
     *    personImage: personImage,
     *    productImages: [productImage],
     *  },
     *  config: {
     *    numberOfImages: 1,
     *  },
     * });
     * console.log(response?.generatedImages?.[0]?.image?.imageBytes);
     * ```
     */
    async recontextImage(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = recontextImageParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:predict", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = recontextImageResponseFromVertex(apiResponse);
          const typedResp = new RecontextImageResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
    /**
     * Segments an image, creating a mask of a specified area.
     *
     * @param params - The parameters for segmenting an image.
     * @return The response from the API.
     *
     * @example
     * ```ts
     * const response = await ai.models.segmentImage({
     *  model: 'image-segmentation-001',
     *  source: {
     *    image: image,
     *  },
     *  config: {
     *    mode: 'foreground',
     *  },
     * });
     * console.log(response?.generatedMasks?.[0]?.mask?.imageBytes);
     * ```
     */
    async segmentImage(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = segmentImageParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:predict", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = segmentImageResponseFromVertex(apiResponse);
          const typedResp = new SegmentImageResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
    /**
     * Fetches information about a model by name.
     *
     * @example
     * ```ts
     * const modelInfo = await ai.models.get({model: 'gemini-2.0-flash'});
     * ```
     */
    async get(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = getModelParametersToVertex(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = modelFromVertex(apiResponse);
          return resp;
        });
      } else {
        const body = getModelParametersToMldev(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = modelFromMldev(apiResponse);
          return resp;
        });
      }
    }
    async listInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = listModelsParametersToVertex(this.apiClient, params);
        path = formatMap("{models_url}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listModelsResponseFromVertex(apiResponse);
          const typedResp = new ListModelsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = listModelsParametersToMldev(this.apiClient, params);
        path = formatMap("{models_url}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listModelsResponseFromMldev(apiResponse);
          const typedResp = new ListModelsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Updates a tuned model by its name.
     *
     * @param params - The parameters for updating the model.
     * @return The response from the API.
     *
     * @example
     * ```ts
     * const response = await ai.models.update({
     *   model: 'tuned-model-name',
     *   config: {
     *     displayName: 'New display name',
     *     description: 'New description',
     *   },
     * });
     * ```
     */
    async update(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = updateModelParametersToVertex(this.apiClient, params);
        path = formatMap("{model}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "PATCH",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = modelFromVertex(apiResponse);
          return resp;
        });
      } else {
        const body = updateModelParametersToMldev(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "PATCH",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = modelFromMldev(apiResponse);
          return resp;
        });
      }
    }
    /**
     * Deletes a tuned model by its name.
     *
     * @param params - The parameters for deleting the model.
     * @return The response from the API.
     *
     * @example
     * ```ts
     * const response = await ai.models.delete({model: 'tuned-model-name'});
     * ```
     */
    async delete(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = deleteModelParametersToVertex(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = deleteModelResponseFromVertex(apiResponse);
          const typedResp = new DeleteModelResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = deleteModelParametersToMldev(this.apiClient, params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = deleteModelResponseFromMldev(apiResponse);
          const typedResp = new DeleteModelResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Counts the number of tokens in the given contents. Multimodal input is
     * supported for Gemini models.
     *
     * @param params - The parameters for counting tokens.
     * @return The response from the API.
     *
     * @example
     * ```ts
     * const response = await ai.models.countTokens({
     *  model: 'gemini-2.0-flash',
     *  contents: 'The quick brown fox jumps over the lazy dog.'
     * });
     * console.log(response);
     * ```
     */
    async countTokens(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = countTokensParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:countTokens", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = countTokensResponseFromVertex(apiResponse);
          const typedResp = new CountTokensResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = countTokensParametersToMldev(this.apiClient, params);
        path = formatMap("{model}:countTokens", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = countTokensResponseFromMldev(apiResponse);
          const typedResp = new CountTokensResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Given a list of contents, returns a corresponding TokensInfo containing
     * the list of tokens and list of token ids.
     *
     * This method is not supported by the Gemini Developer API.
     *
     * @param params - The parameters for computing tokens.
     * @return The response from the API.
     *
     * @example
     * ```ts
     * const response = await ai.models.computeTokens({
     *  model: 'gemini-2.0-flash',
     *  contents: 'What is your name?'
     * });
     * console.log(response);
     * ```
     */
    async computeTokens(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = computeTokensParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:computeTokens", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = computeTokensResponseFromVertex(apiResponse);
          const typedResp = new ComputeTokensResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
    /**
     * Private method for generating videos.
     */
    async generateVideosInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = generateVideosParametersToVertex(this.apiClient, params);
        path = formatMap("{model}:predictLongRunning", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = generateVideosOperationFromVertex(apiResponse);
          const typedResp = new GenerateVideosOperation();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = generateVideosParametersToMldev(this.apiClient, params);
        path = formatMap("{model}:predictLongRunning", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = generateVideosOperationFromMldev(apiResponse);
          const typedResp = new GenerateVideosOperation();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
  };
  var Operations = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
    }
    /**
     * Gets the status of a long-running operation.
     *
     * @param parameters The parameters for the get operation request.
     * @return The updated Operation object, with the latest status or result.
     */
    async getVideosOperation(parameters) {
      const operation = parameters.operation;
      const config = parameters.config;
      if (operation.name === void 0 || operation.name === "") {
        throw new Error("Operation name is required.");
      }
      if (this.apiClient.isVertexAI()) {
        const resourceName2 = operation.name.split("/operations/")[0];
        let httpOptions = void 0;
        if (config && "httpOptions" in config) {
          httpOptions = config.httpOptions;
        }
        const rawOperation = await this.fetchPredictVideosOperationInternal({
          operationName: operation.name,
          resourceName: resourceName2,
          config: { httpOptions }
        });
        return operation._fromAPIResponse({
          apiResponse: rawOperation,
          _isVertexAI: true
        });
      } else {
        const rawOperation = await this.getVideosOperationInternal({
          operationName: operation.name,
          config
        });
        return operation._fromAPIResponse({
          apiResponse: rawOperation,
          _isVertexAI: false
        });
      }
    }
    /**
     * Gets the status of a long-running operation.
     *
     * @param parameters The parameters for the get operation request.
     * @return The updated Operation object, with the latest status or result.
     */
    async get(parameters) {
      const operation = parameters.operation;
      const config = parameters.config;
      if (operation.name === void 0 || operation.name === "") {
        throw new Error("Operation name is required.");
      }
      if (this.apiClient.isVertexAI()) {
        const resourceName2 = operation.name.split("/operations/")[0];
        let httpOptions = void 0;
        if (config && "httpOptions" in config) {
          httpOptions = config.httpOptions;
        }
        const rawOperation = await this.fetchPredictVideosOperationInternal({
          operationName: operation.name,
          resourceName: resourceName2,
          config: { httpOptions }
        });
        return operation._fromAPIResponse({
          apiResponse: rawOperation,
          _isVertexAI: true
        });
      } else {
        const rawOperation = await this.getVideosOperationInternal({
          operationName: operation.name,
          config
        });
        return operation._fromAPIResponse({
          apiResponse: rawOperation,
          _isVertexAI: false
        });
      }
    }
    async getVideosOperationInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = getOperationParametersToVertex(params);
        path = formatMap("{operationName}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response;
      } else {
        const body = getOperationParametersToMldev(params);
        path = formatMap("{operationName}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response;
      }
    }
    async fetchPredictVideosOperationInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = fetchPredictOperationParametersToVertex(params);
        path = formatMap("{resourceName}:fetchPredictOperation", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response;
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
  };
  function audioTranscriptionConfigToMldev(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["languageCodes"]) !== void 0) {
      throw new Error("languageCodes parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromLanguageAuto = getValueByPath(fromObject, ["languageAuto"]);
    if (fromLanguageAuto != null) {
      setValueByPath(toObject, ["languageAuto"], fromLanguageAuto);
    }
    const fromLanguageHints = getValueByPath(fromObject, [
      "languageHints"
    ]);
    if (fromLanguageHints != null) {
      setValueByPath(toObject, ["languageHints"], fromLanguageHints);
    }
    const fromAdaptationPhrases = getValueByPath(fromObject, [
      "adaptationPhrases"
    ]);
    if (fromAdaptationPhrases != null) {
      setValueByPath(toObject, ["adaptationPhrases"], fromAdaptationPhrases);
    }
    return toObject;
  }
  function authConfigToMldev(fromObject) {
    const toObject = {};
    const fromApiKey = getValueByPath(fromObject, ["apiKey"]);
    if (fromApiKey != null) {
      setValueByPath(toObject, ["apiKey"], fromApiKey);
    }
    if (getValueByPath(fromObject, ["apiKeyConfig"]) !== void 0) {
      throw new Error("apiKeyConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["authType"]) !== void 0) {
      throw new Error("authType parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["googleServiceAccountConfig"]) !== void 0) {
      throw new Error("googleServiceAccountConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["httpBasicAuthConfig"]) !== void 0) {
      throw new Error("httpBasicAuthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oauthConfig"]) !== void 0) {
      throw new Error("oauthConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["oidcConfig"]) !== void 0) {
      throw new Error("oidcConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function blobToMldev(fromObject) {
    const toObject = {};
    const fromData = getValueByPath(fromObject, ["data"]);
    if (fromData != null) {
      setValueByPath(toObject, ["data"], fromData);
    }
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function contentToMldev(fromObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToMldev(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function createAuthTokenConfigToMldev(apiClient, fromObject, parentObject) {
    const toObject = {};
    const fromExpireTime = getValueByPath(fromObject, ["expireTime"]);
    if (parentObject !== void 0 && fromExpireTime != null) {
      setValueByPath(parentObject, ["expireTime"], fromExpireTime);
    }
    const fromNewSessionExpireTime = getValueByPath(fromObject, [
      "newSessionExpireTime"
    ]);
    if (parentObject !== void 0 && fromNewSessionExpireTime != null) {
      setValueByPath(parentObject, ["newSessionExpireTime"], fromNewSessionExpireTime);
    }
    const fromUses = getValueByPath(fromObject, ["uses"]);
    if (parentObject !== void 0 && fromUses != null) {
      setValueByPath(parentObject, ["uses"], fromUses);
    }
    const fromLiveConnectConstraints = getValueByPath(fromObject, [
      "liveConnectConstraints"
    ]);
    if (parentObject !== void 0 && fromLiveConnectConstraints != null) {
      setValueByPath(parentObject, ["bidiGenerateContentSetup"], liveConnectConstraintsToMldev(apiClient, fromLiveConnectConstraints));
    }
    const fromLockAdditionalFields = getValueByPath(fromObject, [
      "lockAdditionalFields"
    ]);
    if (parentObject !== void 0 && fromLockAdditionalFields != null) {
      setValueByPath(parentObject, ["fieldMask"], fromLockAdditionalFields);
    }
    return toObject;
  }
  function createAuthTokenParametersToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["config"], createAuthTokenConfigToMldev(apiClient, fromConfig, toObject));
    }
    return toObject;
  }
  function fileDataToMldev(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["displayName"]) !== void 0) {
      throw new Error("displayName parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFileUri = getValueByPath(fromObject, ["fileUri"]);
    if (fromFileUri != null) {
      setValueByPath(toObject, ["fileUri"], fromFileUri);
    }
    const fromMimeType = getValueByPath(fromObject, ["mimeType"]);
    if (fromMimeType != null) {
      setValueByPath(toObject, ["mimeType"], fromMimeType);
    }
    return toObject;
  }
  function functionCallToMldev(fromObject) {
    const toObject = {};
    const fromId = getValueByPath(fromObject, ["id"]);
    if (fromId != null) {
      setValueByPath(toObject, ["id"], fromId);
    }
    const fromArgs = getValueByPath(fromObject, ["args"]);
    if (fromArgs != null) {
      setValueByPath(toObject, ["args"], fromArgs);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    if (getValueByPath(fromObject, ["partialArgs"]) !== void 0) {
      throw new Error("partialArgs parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["willContinue"]) !== void 0) {
      throw new Error("willContinue parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function googleMapsToMldev(fromObject) {
    const toObject = {};
    const fromAuthConfig = getValueByPath(fromObject, ["authConfig"]);
    if (fromAuthConfig != null) {
      setValueByPath(toObject, ["authConfig"], authConfigToMldev(fromAuthConfig));
    }
    const fromEnableWidget = getValueByPath(fromObject, ["enableWidget"]);
    if (fromEnableWidget != null) {
      setValueByPath(toObject, ["enableWidget"], fromEnableWidget);
    }
    return toObject;
  }
  function googleSearchToMldev(fromObject) {
    const toObject = {};
    const fromSearchTypes = getValueByPath(fromObject, ["searchTypes"]);
    if (fromSearchTypes != null) {
      setValueByPath(toObject, ["searchTypes"], fromSearchTypes);
    }
    if (getValueByPath(fromObject, ["blockingConfidence"]) !== void 0) {
      throw new Error("blockingConfidence parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["excludeDomains"]) !== void 0) {
      throw new Error("excludeDomains parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromTimeRangeFilter = getValueByPath(fromObject, [
      "timeRangeFilter"
    ]);
    if (fromTimeRangeFilter != null) {
      setValueByPath(toObject, ["timeRangeFilter"], fromTimeRangeFilter);
    }
    return toObject;
  }
  function liveConnectConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromGenerationConfig = getValueByPath(fromObject, [
      "generationConfig"
    ]);
    if (parentObject !== void 0 && fromGenerationConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig"], fromGenerationConfig);
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (parentObject !== void 0 && fromResponseModalities != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "responseModalities"], fromResponseModalities);
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (parentObject !== void 0 && fromTemperature != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "temperature"], fromTemperature);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (parentObject !== void 0 && fromTopP != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "topP"], fromTopP);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (parentObject !== void 0 && fromTopK != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "topK"], fromTopK);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (parentObject !== void 0 && fromMaxOutputTokens != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (parentObject !== void 0 && fromMediaResolution != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "mediaResolution"], fromMediaResolution);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (parentObject !== void 0 && fromSeed != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "seed"], fromSeed);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (parentObject !== void 0 && fromSpeechConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "speechConfig"], tLiveSpeechConfig(fromSpeechConfig));
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (parentObject !== void 0 && fromThinkingConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "thinkingConfig"], fromThinkingConfig);
    }
    const fromEnableAffectiveDialog = getValueByPath(fromObject, [
      "enableAffectiveDialog"
    ]);
    if (parentObject !== void 0 && fromEnableAffectiveDialog != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "enableAffectiveDialog"], fromEnableAffectiveDialog);
    }
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (parentObject !== void 0 && fromSystemInstruction != null) {
      setValueByPath(parentObject, ["setup", "systemInstruction"], contentToMldev(tContent(fromSystemInstruction)));
    }
    const fromTools = getValueByPath(fromObject, ["tools"]);
    if (parentObject !== void 0 && fromTools != null) {
      let transformedList = tTools(fromTools);
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return toolToMldev(tTool(item));
        });
      }
      setValueByPath(parentObject, ["setup", "tools"], transformedList);
    }
    const fromSessionResumption = getValueByPath(fromObject, [
      "sessionResumption"
    ]);
    if (parentObject !== void 0 && fromSessionResumption != null) {
      setValueByPath(parentObject, ["setup", "sessionResumption"], sessionResumptionConfigToMldev(fromSessionResumption));
    }
    const fromInputAudioTranscription = getValueByPath(fromObject, [
      "inputAudioTranscription"
    ]);
    if (parentObject !== void 0 && fromInputAudioTranscription != null) {
      setValueByPath(parentObject, ["setup", "inputAudioTranscription"], audioTranscriptionConfigToMldev(fromInputAudioTranscription));
    }
    const fromOutputAudioTranscription = getValueByPath(fromObject, [
      "outputAudioTranscription"
    ]);
    if (parentObject !== void 0 && fromOutputAudioTranscription != null) {
      setValueByPath(parentObject, ["setup", "outputAudioTranscription"], audioTranscriptionConfigToMldev(fromOutputAudioTranscription));
    }
    const fromRealtimeInputConfig = getValueByPath(fromObject, [
      "realtimeInputConfig"
    ]);
    if (parentObject !== void 0 && fromRealtimeInputConfig != null) {
      setValueByPath(parentObject, ["setup", "realtimeInputConfig"], fromRealtimeInputConfig);
    }
    const fromContextWindowCompression = getValueByPath(fromObject, [
      "contextWindowCompression"
    ]);
    if (parentObject !== void 0 && fromContextWindowCompression != null) {
      setValueByPath(parentObject, ["setup", "contextWindowCompression"], fromContextWindowCompression);
    }
    const fromProactivity = getValueByPath(fromObject, ["proactivity"]);
    if (parentObject !== void 0 && fromProactivity != null) {
      setValueByPath(parentObject, ["setup", "proactivity"], fromProactivity);
    }
    if (getValueByPath(fromObject, ["explicitVadSignal"]) !== void 0) {
      throw new Error("explicitVadSignal parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromAvatarConfig = getValueByPath(fromObject, ["avatarConfig"]);
    if (parentObject !== void 0 && fromAvatarConfig != null) {
      setValueByPath(parentObject, ["setup", "avatarConfig"], fromAvatarConfig);
    }
    const fromSafetySettings = getValueByPath(fromObject, [
      "safetySettings"
    ]);
    if (parentObject !== void 0 && fromSafetySettings != null) {
      let transformedList = fromSafetySettings;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return safetySettingToMldev(item);
        });
      }
      setValueByPath(parentObject, ["setup", "safetySettings"], transformedList);
    }
    const fromTranslationConfig = getValueByPath(fromObject, [
      "translationConfig"
    ]);
    if (parentObject !== void 0 && fromTranslationConfig != null) {
      setValueByPath(parentObject, ["setup", "generationConfig", "translationConfig"], fromTranslationConfig);
    }
    return toObject;
  }
  function liveConnectConstraintsToMldev(apiClient, fromObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["model"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["setup", "model"], tModel(apiClient, fromModel));
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      setValueByPath(toObject, ["config"], liveConnectConfigToMldev(fromConfig, toObject));
    }
    return toObject;
  }
  function partToMldev(fromObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], fromCodeExecutionResult);
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], fromExecutableCode);
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fileDataToMldev(fromFileData));
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], functionCallToMldev(fromFunctionCall));
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], blobToMldev(fromInlineData));
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    const fromToolCall = getValueByPath(fromObject, ["toolCall"]);
    if (fromToolCall != null) {
      setValueByPath(toObject, ["toolCall"], fromToolCall);
    }
    const fromToolResponse = getValueByPath(fromObject, ["toolResponse"]);
    if (fromToolResponse != null) {
      setValueByPath(toObject, ["toolResponse"], fromToolResponse);
    }
    const fromPartMetadata = getValueByPath(fromObject, ["partMetadata"]);
    if (fromPartMetadata != null) {
      setValueByPath(toObject, ["partMetadata"], fromPartMetadata);
    }
    return toObject;
  }
  function safetySettingToMldev(fromObject) {
    const toObject = {};
    const fromCategory = getValueByPath(fromObject, ["category"]);
    if (fromCategory != null) {
      setValueByPath(toObject, ["category"], fromCategory);
    }
    if (getValueByPath(fromObject, ["method"]) !== void 0) {
      throw new Error("method parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromThreshold = getValueByPath(fromObject, ["threshold"]);
    if (fromThreshold != null) {
      setValueByPath(toObject, ["threshold"], fromThreshold);
    }
    return toObject;
  }
  function sessionResumptionConfigToMldev(fromObject) {
    const toObject = {};
    const fromHandle = getValueByPath(fromObject, ["handle"]);
    if (fromHandle != null) {
      setValueByPath(toObject, ["handle"], fromHandle);
    }
    if (getValueByPath(fromObject, ["transparent"]) !== void 0) {
      throw new Error("transparent parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function toolToMldev(fromObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["retrieval"]) !== void 0) {
      throw new Error("retrieval parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromComputerUse = getValueByPath(fromObject, ["computerUse"]);
    if (fromComputerUse != null) {
      setValueByPath(toObject, ["computerUse"], fromComputerUse);
    }
    const fromFileSearch = getValueByPath(fromObject, ["fileSearch"]);
    if (fromFileSearch != null) {
      setValueByPath(toObject, ["fileSearch"], fromFileSearch);
    }
    const fromGoogleSearch = getValueByPath(fromObject, ["googleSearch"]);
    if (fromGoogleSearch != null) {
      setValueByPath(toObject, ["googleSearch"], googleSearchToMldev(fromGoogleSearch));
    }
    const fromGoogleMaps = getValueByPath(fromObject, ["googleMaps"]);
    if (fromGoogleMaps != null) {
      setValueByPath(toObject, ["googleMaps"], googleMapsToMldev(fromGoogleMaps));
    }
    const fromCodeExecution = getValueByPath(fromObject, [
      "codeExecution"
    ]);
    if (fromCodeExecution != null) {
      setValueByPath(toObject, ["codeExecution"], fromCodeExecution);
    }
    if (getValueByPath(fromObject, ["enterpriseWebSearch"]) !== void 0) {
      throw new Error("enterpriseWebSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromFunctionDeclarations = getValueByPath(fromObject, [
      "functionDeclarations"
    ]);
    if (fromFunctionDeclarations != null) {
      let transformedList = fromFunctionDeclarations;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["functionDeclarations"], transformedList);
    }
    const fromGoogleSearchRetrieval = getValueByPath(fromObject, [
      "googleSearchRetrieval"
    ]);
    if (fromGoogleSearchRetrieval != null) {
      setValueByPath(toObject, ["googleSearchRetrieval"], fromGoogleSearchRetrieval);
    }
    if (getValueByPath(fromObject, ["parallelAiSearch"]) !== void 0) {
      throw new Error("parallelAiSearch parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromUrlContext = getValueByPath(fromObject, ["urlContext"]);
    if (fromUrlContext != null) {
      setValueByPath(toObject, ["urlContext"], fromUrlContext);
    }
    const fromMcpServers = getValueByPath(fromObject, ["mcpServers"]);
    if (fromMcpServers != null) {
      let transformedList = fromMcpServers;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["mcpServers"], transformedList);
    }
    return toObject;
  }
  function getFieldMasks(setup) {
    const fields = [];
    for (const key in setup) {
      if (Object.prototype.hasOwnProperty.call(setup, key)) {
        const value = setup[key];
        if (typeof value === "object" && value != null && Object.keys(value).length > 0) {
          const field = Object.keys(value).map((kk) => `${key}.${kk}`);
          fields.push(...field);
        } else {
          fields.push(key);
        }
      }
    }
    return fields.join(",");
  }
  function convertBidiSetupToTokenSetup(requestDict, config) {
    let setupForMaskGeneration = null;
    const bidiGenerateContentSetupValue = requestDict["bidiGenerateContentSetup"];
    if (typeof bidiGenerateContentSetupValue === "object" && bidiGenerateContentSetupValue !== null && "setup" in bidiGenerateContentSetupValue) {
      const innerSetup = bidiGenerateContentSetupValue.setup;
      if (typeof innerSetup === "object" && innerSetup !== null) {
        requestDict["bidiGenerateContentSetup"] = innerSetup;
        setupForMaskGeneration = innerSetup;
      } else {
        delete requestDict["bidiGenerateContentSetup"];
      }
    } else if (bidiGenerateContentSetupValue !== void 0) {
      delete requestDict["bidiGenerateContentSetup"];
    }
    const preExistingFieldMask = requestDict["fieldMask"];
    if (setupForMaskGeneration) {
      const generatedMaskFromBidi = getFieldMasks(setupForMaskGeneration);
      if (Array.isArray(config === null || config === void 0 ? void 0 : config.lockAdditionalFields) && (config === null || config === void 0 ? void 0 : config.lockAdditionalFields.length) === 0) {
        if (generatedMaskFromBidi) {
          requestDict["fieldMask"] = generatedMaskFromBidi;
        } else {
          delete requestDict["fieldMask"];
        }
      } else if ((config === null || config === void 0 ? void 0 : config.lockAdditionalFields) && config.lockAdditionalFields.length > 0 && preExistingFieldMask !== null && Array.isArray(preExistingFieldMask) && preExistingFieldMask.length > 0) {
        const generationConfigFields = [
          "temperature",
          "topK",
          "topP",
          "maxOutputTokens",
          "responseModalities",
          "seed",
          "speechConfig"
        ];
        let mappedFieldsFromPreExisting = [];
        if (preExistingFieldMask.length > 0) {
          mappedFieldsFromPreExisting = preExistingFieldMask.map((field) => {
            if (generationConfigFields.includes(field)) {
              return `generationConfig.${field}`;
            }
            return field;
          });
        }
        const finalMaskParts = [];
        if (generatedMaskFromBidi) {
          finalMaskParts.push(generatedMaskFromBidi);
        }
        if (mappedFieldsFromPreExisting.length > 0) {
          finalMaskParts.push(...mappedFieldsFromPreExisting);
        }
        if (finalMaskParts.length > 0) {
          requestDict["fieldMask"] = finalMaskParts.join(",");
        } else {
          delete requestDict["fieldMask"];
        }
      } else {
        delete requestDict["fieldMask"];
      }
    } else {
      if (preExistingFieldMask !== null && Array.isArray(preExistingFieldMask) && preExistingFieldMask.length > 0) {
        requestDict["fieldMask"] = preExistingFieldMask.join(",");
      } else {
        delete requestDict["fieldMask"];
      }
    }
    return requestDict;
  }
  var Tokens = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
    }
    /**
     * Creates an ephemeral auth token resource.
     *
     * @experimental
     *
     * @remarks
     * Ephemeral auth tokens is only supported in the Gemini Developer API.
     * It can be used for the session connection to the Live constrained API.
     * Support in v1alpha only.
     *
     * @param params - The parameters for the create request.
     * @return The created auth token.
     *
     * @example
     * ```ts
     * const ai = new GoogleGenAI({
     *     apiKey: token.name,
     *     httpOptions: { apiVersion: 'v1alpha' }  // Support in v1alpha only.
     * });
     *
     * // Case 1: If LiveEphemeralParameters is unset, unlock LiveConnectConfig
     * // when using the token in Live API sessions. Each session connection can
     * // use a different configuration.
     * const config: CreateAuthTokenConfig = {
     *     uses: 3,
     *     expireTime: '2025-05-01T00:00:00Z',
     * }
     * const token = await ai.tokens.create(config);
     *
     * // Case 2: If LiveEphemeralParameters is set, lock all fields in
     * // LiveConnectConfig when using the token in Live API sessions. For
     * // example, changing `outputAudioTranscription` in the Live API
     * // connection will be ignored by the API.
     * const config: CreateAuthTokenConfig =
     *     uses: 3,
     *     expireTime: '2025-05-01T00:00:00Z',
     *     LiveEphemeralParameters: {
     *        model: 'gemini-2.0-flash-001',
     *        config: {
     *           'responseModalities': ['AUDIO'],
     *           'systemInstruction': 'Always answer in English.',
     *        }
     *     }
     * }
     * const token = await ai.tokens.create(config);
     *
     * // Case 3: If LiveEphemeralParameters is set and lockAdditionalFields is
     * // set, lock LiveConnectConfig with set and additional fields (e.g.
     * // responseModalities, systemInstruction, temperature in this example) when
     * // using the token in Live API sessions.
     * const config: CreateAuthTokenConfig =
     *     uses: 3,
     *     expireTime: '2025-05-01T00:00:00Z',
     *     LiveEphemeralParameters: {
     *        model: 'gemini-2.0-flash-001',
     *        config: {
     *           'responseModalities': ['AUDIO'],
     *           'systemInstruction': 'Always answer in English.',
     *        }
     *     },
     *     lockAdditionalFields: ['temperature'],
     * }
     * const token = await ai.tokens.create(config);
     *
     * // Case 4: If LiveEphemeralParameters is set and lockAdditionalFields is
     * // empty array, lock LiveConnectConfig with set fields (e.g.
     * // responseModalities, systemInstruction in this example) when using the
     * // token in Live API sessions.
     * const config: CreateAuthTokenConfig =
     *     uses: 3,
     *     expireTime: '2025-05-01T00:00:00Z',
     *     LiveEphemeralParameters: {
     *        model: 'gemini-2.0-flash-001',
     *        config: {
     *           'responseModalities': ['AUDIO'],
     *           'systemInstruction': 'Always answer in English.',
     *        }
     *     },
     *     lockAdditionalFields: [],
     * }
     * const token = await ai.tokens.create(config);
     * ```
     */
    async create(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("The client.tokens.create method is only supported by the Gemini Developer API.");
      } else {
        const body = createAuthTokenParametersToMldev(this.apiClient, params);
        path = formatMap("auth_tokens", body["_url"]);
        queryParams = body["_query"];
        delete body["config"];
        delete body["_url"];
        delete body["_query"];
        const transformedBody = convertBidiSetupToTokenSetup(body, params.config);
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(transformedBody),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
  };
  function deleteDocumentConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromForce = getValueByPath(fromObject, ["force"]);
    if (parentObject !== void 0 && fromForce != null) {
      setValueByPath(parentObject, ["_query", "force"], fromForce);
    }
    return toObject;
  }
  function deleteDocumentParametersToMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      deleteDocumentConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function getDocumentParametersToMldev(fromObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    return toObject;
  }
  function listDocumentsConfigToMldev(fromObject, parentObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    return toObject;
  }
  function listDocumentsParametersToMldev(fromObject) {
    const toObject = {};
    const fromParent = getValueByPath(fromObject, ["parent"]);
    if (fromParent != null) {
      setValueByPath(toObject, ["_url", "parent"], fromParent);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listDocumentsConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function listDocumentsResponseFromMldev(fromObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromDocuments = getValueByPath(fromObject, ["documents"]);
    if (fromDocuments != null) {
      let transformedList = fromDocuments;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["documents"], transformedList);
    }
    return toObject;
  }
  var Documents = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
      this.list = async (params) => {
        return new Pager(PagedItem.PAGED_ITEM_DOCUMENTS, (x) => this.listInternal({ parent: params.parent, config: x.config }), await this.listInternal(params), params);
      };
    }
    /**
     * Gets a Document.
     *
     * @param params - The parameters for getting a document.
     * @return Document.
     */
    async get(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = getDocumentParametersToMldev(params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
    /**
     * Deletes a Document.
     *
     * @param params - The parameters for deleting a document.
     */
    async delete(params) {
      var _a2, _b;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = deleteDocumentParametersToMldev(params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        await this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        });
      }
    }
    async listInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = listDocumentsParametersToMldev(params);
        path = formatMap("{parent}/documents", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = listDocumentsResponseFromMldev(apiResponse);
          const typedResp = new ListDocumentsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
  };
  var FileSearchStores = class extends BaseModule {
    constructor(apiClient, documents = new Documents(apiClient)) {
      super();
      this.apiClient = apiClient;
      this.documents = documents;
      this.list = async (params = {}) => {
        return new Pager(PagedItem.PAGED_ITEM_FILE_SEARCH_STORES, (x) => this.listInternal(x), await this.listInternal(params), params);
      };
    }
    /**
     * Uploads a file asynchronously to a given File Search Store.
     * This method is not available in Gemini Enterprise Agent Platform (previously known as Vertex AI).
     * Supported upload sources:
     * - Node.js: File path (string) or Blob object.
     * - Browser: Blob object (e.g., File).
     *
     * @remarks
     * The `mimeType` can be specified in the `config` parameter. If omitted:
     *  - For file path (string) inputs, the `mimeType` will be inferred from the
     *     file extension.
     *  - For Blob object inputs, the `mimeType` will be set to the Blob's `type`
     *     property.
     *
     * This section can contain multiple paragraphs and code examples.
     *
     * @param params - Optional parameters specified in the
     *        `types.UploadToFileSearchStoreParameters` interface.
     *         @see {@link types.UploadToFileSearchStoreParameters#config} for the optional
     *         config in the parameters.
     * @return A promise that resolves to a long running operation.
     * @throws An error if called on a Gemini Enterprise Agent Platform (previously known as Vertex AI) client.
     * @throws An error if the `mimeType` is not provided and can not be inferred,
     * the `mimeType` can be provided in the `params.config` parameter.
     * @throws An error occurs if a suitable upload location cannot be established.
     *
     * @example
     * The following code uploads a file to a given file search store.
     *
     * ```ts
     * const operation = await ai.fileSearchStores.upload({fileSearchStoreName: 'fileSearchStores/foo-bar', file: 'file.txt', config: {
     *   mimeType: 'text/plain',
     * }});
     * console.log(operation.name);
     * ```
     */
    async uploadToFileSearchStore(params) {
      if (this.apiClient.isVertexAI()) {
        throw new Error("Gemini Enterprise Agent Platform (previously known as Vertex AI) does not support uploading files to a file search store.");
      }
      return this.apiClient.uploadFileToFileSearchStore(params.fileSearchStoreName, params.file, params.config);
    }
    /**
     * Downloads media using a Media ID or URI.
     * This method is only supported in the Gemini Developer client.
     *
     * @param uri - The URI or Media ID of the blob.
     * @param config - Optional configuration for the download.
     * @returns A promise that resolves to the blob data as a Uint8Array.
     */
    async downloadMedia(uri, config) {
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported in the Gemini Developer client.");
      }
      const parsedUri = new URL(uri, "http://dummy.com");
      let pathname = parsedUri.pathname;
      if (pathname.startsWith("/")) {
        pathname = pathname.slice(1);
      }
      if (!pathname.includes("/media/")) {
        throw new Error(`Invalid uri format: ${uri}. Expected to contain /media/`);
      }
      const queryParams = {};
      parsedUri.searchParams.forEach((value, key) => {
        queryParams[key] = value;
      });
      queryParams["alt"] = "media";
      const httpOptions = Object.assign({}, config === null || config === void 0 ? void 0 : config.httpOptions);
      const response = await this.apiClient.request({
        path: pathname,
        httpMethod: "GET",
        queryParams,
        httpOptions
      });
      if (response instanceof HttpResponse) {
        const arrayBuffer = await response.responseInternal.arrayBuffer();
        return new Uint8Array(arrayBuffer);
      } else {
        throw new Error("Unexpected response type from downloadMedia");
      }
    }
    /**
     * Creates a File Search Store.
     *
     * @param params - The parameters for creating a File Search Store.
     * @return FileSearchStore.
     */
    async create(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = createFileSearchStoreParametersToMldev(this.apiClient, params);
        path = formatMap("fileSearchStores", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
    /**
     * Gets a File Search Store.
     *
     * @param params - The parameters for getting a File Search Store.
     * @return FileSearchStore.
     */
    async get(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = getFileSearchStoreParametersToMldev(params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((resp) => {
          return resp;
        });
      }
    }
    /**
     * Deletes a File Search Store.
     *
     * @param params - The parameters for deleting a File Search Store.
     */
    async delete(params) {
      var _a2, _b;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = deleteFileSearchStoreParametersToMldev(params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        await this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "DELETE",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        });
      }
    }
    async listInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = listFileSearchStoresParametersToMldev(params);
        path = formatMap("fileSearchStores", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = listFileSearchStoresResponseFromMldev(apiResponse);
          const typedResp = new ListFileSearchStoresResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    async uploadToFileSearchStoreInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = uploadToFileSearchStoreParametersToMldev(params);
        path = formatMap("upload/v1beta/{file_search_store_name}:uploadToFileSearchStore", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = uploadToFileSearchStoreResumableResponseFromMldev(apiResponse);
          const typedResp = new UploadToFileSearchStoreResumableResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    /**
     * Imports a File from File Service to a FileSearchStore.
     *
     * This is a long-running operation, see aip.dev/151
     *
     * @param params - The parameters for importing a file to a file search store.
     * @return ImportFileOperation.
     */
    async importFile(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = importFileParametersToMldev(params);
        path = formatMap("{file_search_store_name}:importFile", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json();
        });
        return response.then((apiResponse) => {
          const resp = importFileOperationFromMldev(apiResponse);
          const typedResp = new ImportFileOperation();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
  };
  function isDeno() {
    if ("Deno" in globalThis) {
      return true;
    }
    return false;
  }
  var envMemo = void 0;
  function env() {
    var _a2, _b, _c, _d, _e, _f;
    if (envMemo) {
      return envMemo;
    }
    const globals = globalThis;
    let envObject = {};
    if (isDeno()) {
      envObject = (_d = (_c = (_b = (_a2 = globals.Deno) === null || _a2 === void 0 ? void 0 : _a2.env) === null || _b === void 0 ? void 0 : _b.toObject) === null || _c === void 0 ? void 0 : _c.call(_b)) !== null && _d !== void 0 ? _d : {};
    } else {
      envObject = (_f = (_e = globals.process) === null || _e === void 0 ? void 0 : _e.env) !== null && _f !== void 0 ? _f : {};
    }
    envMemo = envObject;
    return envMemo;
  }
  function fillGlobals(options) {
    var _a2, _b, _c;
    const clone = Object.assign({}, options);
    const envVars = env();
    if (typeof envVars.GOOGLE_GENAI_API_VERSION !== "undefined") {
      (_a2 = clone.api_version) !== null && _a2 !== void 0 ? _a2 : clone.api_version = envVars.GOOGLE_GENAI_API_VERSION;
    }
    if (typeof envVars.GOOGLE_GENAI_API_REVISION !== "undefined") {
      (_b = clone.api_revision) !== null && _b !== void 0 ? _b : clone.api_revision = envVars.GOOGLE_GENAI_API_REVISION;
    }
    if (typeof envVars.GOOGLE_GENAI_USER_PROJECT !== "undefined") {
      (_c = clone.user_project) !== null && _c !== void 0 ? _c : clone.user_project = envVars.GOOGLE_GENAI_USER_PROJECT;
    }
    return clone;
  }
  var GOOGLE_GENAI_API_REVISION = "2026-05-20";
  var GoogleGenAISecurityProvider = class {
    constructor(options) {
      this.options = options;
    }
    getDefaultHeaders() {
      return this.options.defaultHeaders;
    }
    async resolveGoogleGenAISecurity(url) {
      return securityFromHeaders(await this.options.getAuthHeaders(url));
    }
  };
  var GoogleGenAIAuthHook = class {
    beforeCreateRequest(_hookCtx, input) {
      return Object.assign(Object.assign({}, input), { url: decodeSDKLevelAPIVersionPath(input.url) });
    }
    async beforeRequest(hookCtx, request) {
      applyDefaultHeaders(request.headers, getStaticDefaultHeaders(hookCtx.security_source));
      applyApiRevision(hookCtx, request.headers);
      applyUserProject(hookCtx, request.headers);
      if (hasAuthHeaders(request.headers)) {
        return request;
      }
      const security = await resolveSecurity$1(hookCtx.security_source, request.url);
      applyDefaultHeaders(request.headers, security === null || security === void 0 ? void 0 : security.default_headers);
      applyAuth(request.headers, security);
      return request;
    }
  };
  function decodeSDKLevelAPIVersionPath(url) {
    const [, apiVersion, ...rest] = url.pathname.split("/");
    if (!apiVersion) {
      return url;
    }
    const decodedAPIVersion = decodeURIComponent(apiVersion);
    if (!decodedAPIVersion.includes("/")) {
      return url;
    }
    const nextURL = new URL(url);
    nextURL.pathname = `/${decodedAPIVersion}/${rest.join("/")}`;
    return nextURL;
  }
  async function resolveSecurity$1(securitySource, requestURL) {
    if (isSecurityResolver(securitySource)) {
      return securitySource.resolveGoogleGenAISecurity(requestURL);
    }
    const security = typeof securitySource === "function" ? await securitySource() : securitySource;
    if (isSecurity(security)) {
      return withEnvSecurity(security);
    }
    return withEnvSecurity(void 0);
  }
  function getStaticDefaultHeaders(securitySource) {
    var _a2, _b;
    if (isSecurityResolver(securitySource)) {
      return (_b = (_a2 = securitySource.getDefaultHeaders) === null || _a2 === void 0 ? void 0 : _a2.call(securitySource)) !== null && _b !== void 0 ? _b : securitySource.defaultHeaders;
    }
    if (isSecurity(securitySource)) {
      return securitySource.default_headers;
    }
    return void 0;
  }
  function withEnvSecurity(security) {
    var _a2, _b;
    const envVars = env();
    const nextSecurity = Object.assign(Object.assign({}, security), { api_key: (_a2 = security === null || security === void 0 ? void 0 : security.api_key) !== null && _a2 !== void 0 ? _a2 : envVars.GOOGLE_GENAI_API_KEY, access_token: (_b = security === null || security === void 0 ? void 0 : security.access_token) !== null && _b !== void 0 ? _b : envVars.GOOGLE_GENAI_ACCESS_TOKEN });
    return hasSecurityValue(nextSecurity) ? nextSecurity : void 0;
  }
  function securityFromHeaders(headers) {
    var _a2, _b;
    const defaultHeaders = {};
    for (const [key, value] of headers) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "authorization" && lowerKey !== "x-goog-api-key") {
        defaultHeaders[key] = value;
      }
    }
    const security = {
      access_token: (_a2 = headers.get("authorization")) !== null && _a2 !== void 0 ? _a2 : void 0,
      api_key: (_b = headers.get("x-goog-api-key")) !== null && _b !== void 0 ? _b : void 0,
      default_headers: Object.keys(defaultHeaders).length ? defaultHeaders : void 0
    };
    return hasSecurityValue(security) ? security : void 0;
  }
  function applyDefaultHeaders(target, source) {
    if (!source) {
      return;
    }
    for (const [key, value] of new Headers(source)) {
      if (target.get(key) === null) {
        target.set(key, value);
      }
    }
  }
  function applyApiRevision(hookCtx, headers) {
    var _a2;
    if (headers.get("api-revision") === null) {
      headers.set("Api-Revision", (_a2 = hookCtx.options.api_revision) !== null && _a2 !== void 0 ? _a2 : GOOGLE_GENAI_API_REVISION);
    }
  }
  function applyUserProject(hookCtx, headers) {
    if (hookCtx.options.user_project !== void 0 && headers.get("x-goog-user-project") === null) {
      headers.set("x-goog-user-project", hookCtx.options.user_project);
    }
  }
  function applyAuth(headers, security) {
    if (!security) {
      return;
    }
    if (security.api_key) {
      headers.set("x-goog-api-key", security.api_key);
      return;
    }
    if (security.access_token) {
      headers.set("Authorization", bearer(security.access_token));
    }
  }
  function hasAuthHeaders(headers) {
    return headers.get("authorization") !== null || headers.get("x-goog-api-key") !== null;
  }
  function bearer(token) {
    return token.slice(0, 7).toLowerCase() === "bearer " ? token : `Bearer ${token}`;
  }
  function isSecurity(value) {
    return typeof value === "object" && value !== null;
  }
  function isSecurityResolver(value) {
    return typeof value === "object" && value !== null && "resolveGoogleGenAISecurity" in value && typeof value.resolveGoogleGenAISecurity === "function";
  }
  function hasSecurityValue(security) {
    return security.api_key !== void 0 || security.access_token !== void 0 || security.default_headers !== void 0;
  }
  var HTTPClientError = class extends Error {
    constructor(message, opts) {
      let msg = message;
      if (opts === null || opts === void 0 ? void 0 : opts.cause) {
        msg += `: ${opts.cause}`;
      }
      super(msg, opts);
      this.name = "HTTPClientError";
      if (typeof this.cause === "undefined") {
        this.cause = opts === null || opts === void 0 ? void 0 : opts.cause;
      }
    }
  };
  var UnexpectedClientError = class extends HTTPClientError {
    constructor() {
      super(...arguments);
      this.name = "UnexpectedClientError";
    }
  };
  var InvalidRequestError = class extends HTTPClientError {
    constructor() {
      super(...arguments);
      this.name = "InvalidRequestError";
    }
  };
  var RequestAbortedError = class extends HTTPClientError {
    constructor() {
      super(...arguments);
      this.name = "RequestAbortedError";
    }
  };
  var RequestTimeoutError = class extends HTTPClientError {
    constructor() {
      super(...arguments);
      this.name = "RequestTimeoutError";
    }
  };
  var ConnectionError = class extends HTTPClientError {
    constructor() {
      super(...arguments);
      this.name = "ConnectionError";
    }
  };
  var GoogleGenAiError = class extends Error {
    constructor(message, httpMeta) {
      var _a2, _b, _c, _d;
      super(message);
      this.statusCode = (_a2 = httpMeta === null || httpMeta === void 0 ? void 0 : httpMeta.response) === null || _a2 === void 0 ? void 0 : _a2.status;
      this.body = (_b = httpMeta === null || httpMeta === void 0 ? void 0 : httpMeta.body) !== null && _b !== void 0 ? _b : "";
      this.headers = (_c = httpMeta === null || httpMeta === void 0 ? void 0 : httpMeta.response) === null || _c === void 0 ? void 0 : _c.headers;
      this.contentType = ((_d = httpMeta === null || httpMeta === void 0 ? void 0 : httpMeta.response) === null || _d === void 0 ? void 0 : _d.headers.get("content-type")) || "";
      this.rawResponse = httpMeta === null || httpMeta === void 0 ? void 0 : httpMeta.response;
      this.name = "GoogleGenAiError";
    }
  };
  var GeminiNextGenAPIClientError = class extends Error {
  };
  var APIError = class _APIError extends GeminiNextGenAPIClientError {
    constructor(status, error, message, headers) {
      super(_APIError.makeMessage(status, error, message));
      this.status = status;
      this.headers = headers;
      this.error = error;
      this.statusCode = status;
      this.body = stringifyErrorBody(error);
      this.contentType = (headers === null || headers === void 0 ? void 0 : headers.get("content-type")) || "";
      this.rawResponse = void 0;
      this.cause = void 0;
      this.name = this.constructor.name;
      Object.setPrototypeOf(this, new.target.prototype);
    }
    static makeMessage(status, error, message) {
      var _a2;
      const errorMessage = error && isPlainObject$2(error) && typeof error["message"] === "string" ? error["message"] : void 0;
      const errorBody = stringifyErrorBody(error);
      const msg = (_a2 = errorMessage !== null && errorMessage !== void 0 ? errorMessage : message) !== null && _a2 !== void 0 ? _a2 : errorBody || "An error occurred";
      const statusText = status ? `${status} ` : "";
      return `${statusText}${msg}`;
    }
    static generate(status, errorResponse, message, headers) {
      if (!status || !headers) {
        return new APIConnectionError({
          message,
          cause: errorResponse instanceof Error ? errorResponse : void 0
        });
      }
      if (status === 400) {
        return new BadRequestError(status, errorResponse, message, headers);
      }
      if (status === 401) {
        return new AuthenticationError(status, errorResponse, message, headers);
      }
      if (status === 403) {
        return new PermissionDeniedError(status, errorResponse, message, headers);
      }
      if (status === 404) {
        return new NotFoundError(status, errorResponse, message, headers);
      }
      if (status === 409) {
        return new ConflictError(status, errorResponse, message, headers);
      }
      if (status === 422) {
        return new UnprocessableEntityError(status, errorResponse, message, headers);
      }
      if (status === 429) {
        return new RateLimitError(status, errorResponse, message, headers);
      }
      if (status >= 500) {
        return new InternalServerError(status, errorResponse, message, headers);
      }
      return new _APIError(status, errorResponse, message, headers);
    }
  };
  var APIUserAbortError = class extends APIError {
    constructor({ message } = {}) {
      super(void 0, void 0, message || "Request was aborted.", void 0);
    }
  };
  var APIConnectionError = class extends APIError {
    constructor({ message, cause }) {
      super(void 0, void 0, message || "Connection error.", void 0);
      this.cause = cause;
    }
  };
  var APIConnectionTimeoutError = class extends APIConnectionError {
    constructor({ message } = {}) {
      super({
        message: message || "Request timed out. This is a client-side timeout. You can increase the timeout by setting the `timeout` argument in your request or client http options."
      });
    }
  };
  var BadRequestError = class extends APIError {
  };
  var AuthenticationError = class extends APIError {
  };
  var PermissionDeniedError = class extends APIError {
  };
  var NotFoundError = class extends APIError {
  };
  var ConflictError = class extends APIError {
  };
  var UnprocessableEntityError = class extends APIError {
  };
  var RateLimitError = class extends APIError {
  };
  var InternalServerError = class extends APIError {
  };
  function wrapSDKError(error) {
    if (isCompatAPIErrorInstance(error)) {
      return error;
    }
    if (error instanceof GoogleGenAiError) {
      return wrapAPIError(error);
    }
    if (error instanceof HTTPClientError) {
      return wrapHTTPClientError(error);
    }
    return error;
  }
  function wrapAPIError(error) {
    const errorPayload = getErrorPayload(error);
    const wrapped = APIError.generate(error.statusCode, errorPayload, error.message, error.headers);
    defineReadonly(wrapped, "body", error.body);
    defineReadonly(wrapped, "contentType", error.contentType);
    defineReadonly(wrapped, "rawResponse", error.rawResponse);
    defineReadonly(wrapped, "statusCode", error.statusCode);
    defineReadonly(wrapped, "cause", error);
    return wrapped;
  }
  function wrapHTTPClientError(error) {
    if (error instanceof RequestTimeoutError) {
      return new APIConnectionTimeoutError({ message: error.message });
    }
    if (error instanceof RequestAbortedError) {
      return new APIUserAbortError({ message: error.message });
    }
    if (error instanceof ConnectionError) {
      return new APIConnectionError({ message: error.message, cause: error });
    }
    return new APIConnectionError({ message: error.message, cause: error });
  }
  function getErrorPayload(error) {
    const data = getObjectProperty(error, "data$");
    if (data && typeof data === "object") {
      return data;
    }
    try {
      const parsed = JSON.parse(error.body);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (_a2) {
    }
    const dataError = getObjectProperty(error, "error");
    return dataError && typeof dataError === "object" ? dataError : void 0;
  }
  function getObjectProperty(value, key) {
    return value && typeof value === "object" ? value[key] : void 0;
  }
  function stringifyErrorBody(error) {
    if (!error)
      return "";
    try {
      return JSON.stringify(error);
    } catch (_a2) {
      return String(error);
    }
  }
  function isPlainObject$2(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function isCompatAPIErrorInstance(value) {
    return typeof value === "object" && value !== null ? APIError.prototype.isPrototypeOf(value) : false;
  }
  function defineReadonly(target, key, value) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: false
    });
  }
  function initHooks(hooks) {
    const googleGenAIAuthHook = new GoogleGenAIAuthHook();
    hooks.registerBeforeCreateRequestHook(googleGenAIAuthHook);
    hooks.registerBeforeRequestHook(googleGenAIAuthHook);
  }
  var SDKHooks = class {
    constructor() {
      this.sdkInitHooks = [];
      this.beforeCreateRequestHooks = [];
      this.beforeRequestHooks = [];
      this.afterSuccessHooks = [];
      this.afterErrorHooks = [];
      const presetHooks = [];
      for (const hook of presetHooks) {
        if ("sdkInit" in hook) {
          this.registerSDKInitHook(hook);
        }
        if ("beforeCreateRequest" in hook) {
          this.registerBeforeCreateRequestHook(hook);
        }
        if ("beforeRequest" in hook) {
          this.registerBeforeRequestHook(hook);
        }
        if ("afterSuccess" in hook) {
          this.registerAfterSuccessHook(hook);
        }
        if ("afterError" in hook) {
          this.registerAfterErrorHook(hook);
        }
      }
      initHooks(this);
    }
    registerSDKInitHook(hook) {
      this.sdkInitHooks.push(hook);
    }
    registerBeforeCreateRequestHook(hook) {
      this.beforeCreateRequestHooks.push(hook);
    }
    registerBeforeRequestHook(hook) {
      this.beforeRequestHooks.push(hook);
    }
    registerAfterSuccessHook(hook) {
      this.afterSuccessHooks.push(hook);
    }
    registerAfterErrorHook(hook) {
      this.afterErrorHooks.push(hook);
    }
    sdkInit(opts) {
      return this.sdkInitHooks.reduce((opts2, hook) => hook.sdkInit(opts2), opts);
    }
    beforeCreateRequest(hookCtx, input) {
      let inp = input;
      for (const hook of this.beforeCreateRequestHooks) {
        inp = hook.beforeCreateRequest(hookCtx, inp);
      }
      return inp;
    }
    async beforeRequest(hookCtx, request) {
      let req = request;
      for (const hook of this.beforeRequestHooks) {
        req = await hook.beforeRequest(hookCtx, req);
      }
      return req;
    }
    async afterSuccess(hookCtx, response) {
      let res = response;
      for (const hook of this.afterSuccessHooks) {
        res = await hook.afterSuccess(hookCtx, res);
      }
      return res;
    }
    async afterError(hookCtx, response, error) {
      let res = response;
      let err = error;
      for (const hook of this.afterErrorHooks) {
        const result = await hook.afterError(hookCtx, res, err);
        res = result.response;
        err = result.error;
      }
      return { response: res, error: err };
    }
  };
  function OK(value) {
    return { ok: true, value };
  }
  function ERR(error) {
    return { ok: false, error };
  }
  function bytesToBase64(u8arr) {
    return btoa(String.fromCodePoint(...u8arr));
  }
  function stringToBytes(str) {
    return new TextEncoder().encode(str);
  }
  function stringToBase64(str) {
    return bytesToBase64(stringToBytes(str));
  }
  var hasOwn = Object.prototype.hasOwnProperty;
  function pathToFunc(pathPattern, options) {
    const paramRE = /\{([a-zA-Z0-9_][a-zA-Z0-9_-]*?)\}/g;
    return function buildURLPath(params = {}) {
      return pathPattern.replace(paramRE, function(_, placeholder) {
        if (!hasOwn.call(params, placeholder)) {
          throw new Error(`Parameter '${placeholder}' is required`);
        }
        const value = params[placeholder];
        if (typeof value !== "string" && typeof value !== "number") {
          throw new Error(`Parameter '${placeholder}' must be a string or number`);
        }
        return `${value}`;
      }).replace(/^\/+/, "");
    };
  }
  var ServerList = [
    /**
     * Global Endpoint
     */
    "https://generativelanguage.googleapis.com"
  ];
  function serverURLFromOptions(options) {
    var _a2;
    let serverURL = options.server_url;
    const params = {};
    if (!serverURL) {
      const serverIdx = (_a2 = options.server_idx) !== null && _a2 !== void 0 ? _a2 : 0;
      if (serverIdx < 0 || serverIdx >= ServerList.length) {
        throw new Error(`Invalid server index ${serverIdx}`);
      }
      serverURL = ServerList[serverIdx] || "";
    }
    const u = pathToFunc(serverURL)(params);
    return new URL(u);
  }
  var SDK_METADATA = {
    userAgent: "speakeasy-sdk/typescript 2.4.1-preview.4 2.911.0 v1beta @google/genai"
  };
  function combineSignals(...signals) {
    const filtered = [];
    for (const signal of signals) {
      if (signal) {
        filtered.push(signal);
      }
    }
    switch (filtered.length) {
      case 0:
      case 1:
        return filtered[0] || null;
      default:
        if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
          return AbortSignal.any(filtered);
        }
        return abortSignalAny(filtered);
    }
  }
  function abortSignalAny(signals) {
    const controller = new AbortController();
    const result = controller.signal;
    if (!signals.length) {
      return controller.signal;
    }
    if (signals.length === 1) {
      return signals[0] || controller.signal;
    }
    for (const signal of signals) {
      if (signal.aborted) {
        return signal;
      }
    }
    function abort() {
      controller.abort(this.reason);
      clean();
    }
    const signalRefs = [];
    function clean() {
      for (const signalRef of signalRefs) {
        const signal = signalRef.deref();
        if (signal) {
          signal.removeEventListener("abort", abort);
        }
      }
    }
    for (const signal of signals) {
      signalRefs.push(new WeakRef(signal));
      signal.addEventListener("abort", abort);
    }
    return result;
  }
  function compactMap(values) {
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v !== "undefined") {
        out[k] = v;
      }
    }
    return out;
  }
  function isPlainObject$1(value) {
    if (value === null || typeof value !== "object")
      return false;
    if (Object.prototype.toString.call(value) !== "[object Object]")
      return false;
    const proto = Object.getPrototypeOf(value);
    if (proto === null || proto === Object.prototype)
      return true;
    try {
      return Object.getPrototypeOf(proto) === null;
    } catch (_a2) {
      return false;
    }
  }
  function formEncoder(sep) {
    return (key, value, options) => {
      let out = "";
      const pairs = (options === null || options === void 0 ? void 0 : options.explode) ? explode(key, value) : [[key, value]];
      if (pairs.every(([_, v]) => v == null)) {
        return;
      }
      const encodeString = (v) => {
        return (options === null || options === void 0 ? void 0 : options.charEncoding) === "percent" ? encodeURIComponent(v) : v;
      };
      const encodeValue = (v) => encodeString(serializeValue(v));
      const encodedSep = encodeString(sep);
      pairs.forEach(([pk, pv]) => {
        var _a2, _b;
        let tmp = "";
        let encValue = null;
        if (pv == null) {
          return;
        } else if (Array.isArray(pv)) {
          encValue = (_a2 = mapDefined(pv, (v) => `${encodeValue(v)}`)) === null || _a2 === void 0 ? void 0 : _a2.join(encodedSep);
        } else if (isPlainObject$1(pv)) {
          encValue = (_b = mapDefinedEntries(Object.entries(pv), ([k, v]) => {
            return `${encodeString(k)}${encodedSep}${encodeValue(v)}`;
          })) === null || _b === void 0 ? void 0 : _b.join(encodedSep);
        } else {
          encValue = `${encodeValue(pv)}`;
        }
        if (encValue == null) {
          return;
        }
        tmp = `${encodeString(pk)}=${encValue}`;
        if (!tmp || tmp === "=") {
          return;
        }
        out += `&${tmp}`;
      });
      return out.slice(1);
    };
  }
  var encodeForm = formEncoder(",");
  function encodeJSON(key, value, options) {
    if (typeof value === "undefined") {
      return;
    }
    const encodeString = (v) => {
      return (options === null || options === void 0 ? void 0 : options.charEncoding) === "percent" ? encodeURIComponent(v) : v;
    };
    const encVal = encodeString(JSON.stringify(value, jsonReplacer));
    return (options === null || options === void 0 ? void 0 : options.explode) ? encVal : `${encodeString(key)}=${encVal}`;
  }
  var encodeSimple = (key, value, options) => {
    let out = "";
    const pairs = (options === null || options === void 0 ? void 0 : options.explode) ? explode(key, value) : [[key, value]];
    if (pairs.every(([_, v]) => v == null)) {
      return;
    }
    const encodeString = (v) => {
      return (options === null || options === void 0 ? void 0 : options.charEncoding) === "percent" ? encodeURIComponent(v) : v;
    };
    const encodeValue = (v) => encodeString(serializeValue(v));
    pairs.forEach(([pk, pv]) => {
      var _a2;
      let tmp = "";
      if (pv == null) {
        return;
      } else if (Array.isArray(pv)) {
        tmp = (_a2 = mapDefined(pv, (v) => `${encodeValue(v)}`)) === null || _a2 === void 0 ? void 0 : _a2.join(",");
      } else if (isPlainObject$1(pv)) {
        const mapped = mapDefinedEntries(Object.entries(pv), ([k, v]) => {
          return `,${encodeString(k)},${encodeValue(v)}`;
        });
        tmp = mapped === null || mapped === void 0 ? void 0 : mapped.join("").slice(1);
      } else {
        const k = (options === null || options === void 0 ? void 0 : options.explode) && isPlainObject$1(value) ? `${pk}=` : "";
        tmp = `${k}${encodeValue(pv)}`;
      }
      out += tmp ? `,${tmp}` : "";
    });
    return out.slice(1);
  };
  function explode(key, value) {
    if (Array.isArray(value)) {
      return value.map((v) => [key, v]);
    } else if (isPlainObject$1(value)) {
      const o = value !== null && value !== void 0 ? value : {};
      return Object.entries(o).map(([k, v]) => [k, v]);
    } else {
      return [[key, value]];
    }
  }
  function serializeValue(value) {
    if (value == null) {
      return "";
    } else if (value instanceof Date) {
      return value.toISOString();
    } else if (value instanceof Uint8Array) {
      return bytesToBase64(value);
    } else if (typeof value === "object") {
      return JSON.stringify(value, jsonReplacer);
    }
    return `${value}`;
  }
  function jsonReplacer(_, value) {
    if (value instanceof Uint8Array) {
      return bytesToBase64(value);
    } else {
      return value;
    }
  }
  function mapDefined(inp, mapper) {
    const res = inp.reduce((acc, v) => {
      if (v == null) {
        return acc;
      }
      const m = mapper(v);
      if (m == null) {
        return acc;
      }
      acc.push(m);
      return acc;
    }, []);
    return res.length ? res : null;
  }
  function mapDefinedEntries(inp, mapper) {
    const acc = [];
    for (const [k, v] of inp) {
      if (v == null) {
        continue;
      }
      const m = mapper([k, v]);
      if (m == null) {
        continue;
      }
      acc.push(m);
    }
    return acc.length ? acc : null;
  }
  function queryJoin(...args) {
    return args.filter(Boolean).join("&");
  }
  function queryEncoder(f) {
    const bulkEncode = function(values, options) {
      var _a2, _b, _c;
      const opts = Object.assign(Object.assign({}, options), { explode: (_a2 = options === null || options === void 0 ? void 0 : options.explode) !== null && _a2 !== void 0 ? _a2 : true, charEncoding: (_b = options === null || options === void 0 ? void 0 : options.charEncoding) !== null && _b !== void 0 ? _b : "percent" });
      const allowEmptySet = new Set((_c = options === null || options === void 0 ? void 0 : options.allowEmptyValue) !== null && _c !== void 0 ? _c : []);
      const encoded = Object.entries(values).map(([key, value]) => {
        if (allowEmptySet.has(key)) {
          if (value === void 0 || value === null || value === "" || Array.isArray(value) && value.length === 0) {
            return `${encodeURIComponent(key)}=`;
          }
        }
        return f(key, value, opts);
      });
      return queryJoin(...encoded);
    };
    return bulkEncode;
  }
  var encodeFormQuery = queryEncoder(encodeForm);
  var DEFAULT_FETCHER = (input, init2) => {
    if (init2 == null) {
      return fetch(input);
    } else {
      return fetch(input, init2);
    }
  };
  var HTTPClient = class _HTTPClient {
    constructor(options = {}) {
      this.options = options;
      this.requestHooks = [];
      this.requestErrorHooks = [];
      this.responseHooks = [];
      this.fetcher = options.fetcher || DEFAULT_FETCHER;
    }
    async request(request) {
      let req = request;
      for (const hook of this.requestHooks) {
        const nextRequest = await hook(req);
        if (nextRequest) {
          req = nextRequest;
        }
      }
      try {
        const res = await this.fetcher(req);
        for (const hook of this.responseHooks) {
          await hook(res, req);
        }
        return res;
      } catch (err) {
        for (const hook of this.requestErrorHooks) {
          await hook(err, req);
        }
        throw err;
      }
    }
    addHook(...args) {
      if (args[0] === "beforeRequest") {
        this.requestHooks.push(args[1]);
      } else if (args[0] === "requestError") {
        this.requestErrorHooks.push(args[1]);
      } else if (args[0] === "response") {
        this.responseHooks.push(args[1]);
      } else {
        throw new Error(`Invalid hook type: ${args[0]}`);
      }
      return this;
    }
    removeHook(...args) {
      let target;
      if (args[0] === "beforeRequest") {
        target = this.requestHooks;
      } else if (args[0] === "requestError") {
        target = this.requestErrorHooks;
      } else if (args[0] === "response") {
        target = this.responseHooks;
      } else {
        throw new Error(`Invalid hook type: ${args[0]}`);
      }
      const index = target.findIndex((v) => v === args[1]);
      if (index >= 0) {
        target.splice(index, 1);
      }
      return this;
    }
    clone() {
      const child = new _HTTPClient(this.options);
      child.requestHooks = this.requestHooks.slice();
      child.requestErrorHooks = this.requestErrorHooks.slice();
      child.responseHooks = this.responseHooks.slice();
      return child;
    }
  };
  var mediaParamSeparator = /\s*;\s*/g;
  function matchContentType(response, pattern) {
    var _a2;
    if (pattern === "*") {
      return true;
    }
    let contentType = ((_a2 = response.headers.get("content-type")) === null || _a2 === void 0 ? void 0 : _a2.trim()) || "application/octet-stream";
    contentType = contentType.toLowerCase();
    const wantParts = pattern.toLowerCase().trim().split(mediaParamSeparator);
    const [wantType = "", ...wantParams] = wantParts;
    if (wantType.split("/").length !== 2) {
      return false;
    }
    const gotParts = contentType.split(mediaParamSeparator);
    const [gotType = "", ...gotParams] = gotParts;
    const [type = "", subtype = ""] = gotType.split("/");
    if (!type || !subtype) {
      return false;
    }
    if (wantType !== "*/*" && gotType !== wantType && `${type}/*` !== wantType && `*/${subtype}` !== wantType) {
      return false;
    }
    if (gotParams.length < wantParams.length) {
      return false;
    }
    const params = new Set(gotParams);
    for (const wantParam of wantParams) {
      if (!params.has(wantParam)) {
        return false;
      }
    }
    return true;
  }
  var codeRangeRE$1 = new RegExp("^[0-9]xx$", "i");
  function matchStatusCode(response, codes) {
    const actual = `${response.status}`;
    const expectedCodes = Array.isArray(codes) ? codes : [codes];
    if (!expectedCodes.length) {
      return false;
    }
    return expectedCodes.some((ec) => {
      const code = `${ec}`;
      if (code === "default") {
        return true;
      }
      if (!codeRangeRE$1.test(`${code}`)) {
        return code === actual;
      }
      const expectFamily = code.charAt(0);
      if (!expectFamily) {
        throw new Error("Invalid status code range");
      }
      const actualFamily = actual.charAt(0);
      if (!actualFamily) {
        throw new Error(`Invalid response status code: ${actual}`);
      }
      return actualFamily === expectFamily;
    });
  }
  function matchResponse(response, code, contentTypePattern) {
    return matchStatusCode(response, code) && matchContentType(response, contentTypePattern);
  }
  function isConnectionError(err) {
    if (typeof err !== "object" || err == null) {
      return false;
    }
    const isBrowserErr = err instanceof TypeError && err.message.toLowerCase().startsWith("failed to fetch");
    const isNodeErr = err instanceof TypeError && err.message.toLowerCase().startsWith("fetch failed");
    const isBunErr = "name" in err && err.name === "ConnectionError";
    const isGenericErr = "code" in err && typeof err.code === "string" && err.code.toLowerCase() === "econnreset";
    return isBrowserErr || isNodeErr || isGenericErr || isBunErr;
  }
  function isTimeoutError(err) {
    if (typeof err !== "object" || err == null) {
      return false;
    }
    const isNative = "name" in err && err.name === "TimeoutError";
    const isLegacyNative = "code" in err && err.code === 23;
    const isGenericErr = "code" in err && typeof err.code === "string" && err.code.toLowerCase() === "econnaborted";
    return isNative || isLegacyNative || isGenericErr;
  }
  function isAbortError(err) {
    if (typeof err !== "object" || err == null) {
      return false;
    }
    const isNative = "name" in err && err.name === "AbortError";
    const isLegacyNative = "code" in err && err.code === 20;
    const isGenericErr = "code" in err && typeof err.code === "string" && err.code.toLowerCase() === "econnaborted";
    return isNative || isLegacyNative || isGenericErr;
  }
  var defaultBackoff = {
    initialInterval: 500,
    maxInterval: 6e4,
    exponent: 1.5,
    maxElapsedTime: 36e5
  };
  var PermanentError = class _PermanentError extends Error {
    constructor(message, options) {
      let msg = message;
      if (options === null || options === void 0 ? void 0 : options.cause) {
        msg += `: ${options.cause}`;
      }
      super(msg, options);
      this.name = "PermanentError";
      if (typeof this.cause === "undefined") {
        this.cause = options === null || options === void 0 ? void 0 : options.cause;
      }
      Object.setPrototypeOf(this, _PermanentError.prototype);
    }
  };
  var TemporaryError = class _TemporaryError extends Error {
    constructor(message, response) {
      super(message);
      this.response = response;
      this.name = "TemporaryError";
      Object.setPrototypeOf(this, _TemporaryError.prototype);
    }
  };
  async function retry(fetchFn, options) {
    var _a2;
    switch (options.config.strategy) {
      case "backoff":
        return retryBackoff(wrapFetcher(fetchFn, {
          statusCodes: options.statusCodes,
          retryConnectionErrors: !!options.config.retryConnectionErrors
        }), (_a2 = options.config.backoff) !== null && _a2 !== void 0 ? _a2 : defaultBackoff);
      case "attempt-count-backoff":
        return retryAttemptCountBackoff(wrapFetcher(fetchFn, {
          statusCodes: options.statusCodes,
          retryConnectionErrors: !!options.config.retryConnectionErrors
        }), Object.assign(Object.assign({}, defaultBackoff), options.config.backoff), options.config);
      default:
        return await fetchFn(0);
    }
  }
  function wrapFetcher(fn, options) {
    return async (attempt) => {
      try {
        const res = await fn(attempt);
        if (isRetryableResponse(res, options.statusCodes)) {
          throw new TemporaryError("Response failed with retryable status code", res);
        }
        return res;
      } catch (err) {
        if (err instanceof TemporaryError) {
          throw err;
        }
        if (options.retryConnectionErrors && (isTimeoutError(err) || isConnectionError(err))) {
          throw err;
        }
        throw new PermanentError("Permanent error", { cause: err });
      }
    };
  }
  var codeRangeRE = new RegExp("^[0-9]xx$", "i");
  function isRetryableResponse(res, statusCodes) {
    const actual = `${res.status}`;
    return statusCodes.some((code) => {
      if (!codeRangeRE.test(code)) {
        return code === actual;
      }
      const expectFamily = code.charAt(0);
      if (!expectFamily) {
        throw new Error("Invalid status code range");
      }
      const actualFamily = actual.charAt(0);
      if (!actualFamily) {
        throw new Error(`Invalid response status code: ${actual}`);
      }
      return actualFamily === expectFamily;
    });
  }
  async function retryBackoff(fn, strategy) {
    const { maxElapsedTime, initialInterval, exponent, maxInterval } = strategy;
    const start2 = Date.now();
    let x = 0;
    while (true) {
      try {
        const res = await fn(x);
        return res;
      } catch (err) {
        if (err instanceof PermanentError) {
          throw err.cause;
        }
        const elapsed = Date.now() - start2;
        if (elapsed > maxElapsedTime) {
          if (err instanceof TemporaryError) {
            return err.response;
          }
          throw err;
        }
        let retryInterval = 0;
        if (err instanceof TemporaryError) {
          retryInterval = retryIntervalFromResponse(err.response);
        }
        if (retryInterval <= 0) {
          retryInterval = initialInterval * Math.pow(x, exponent) + Math.random() * 1e3;
        }
        const d = Math.min(retryInterval, maxInterval);
        await delay(d);
        x++;
      }
    }
  }
  async function retryAttemptCountBackoff(fn, strategy, config) {
    let attempt = 0;
    while (true) {
      try {
        return await fn(attempt);
      } catch (err) {
        if (err instanceof PermanentError) {
          throw err.cause;
        }
        if (attempt >= config.maxRetries) {
          if (err instanceof TemporaryError) {
            return err.response;
          }
          throw err;
        }
        let retryInterval = 0;
        if (err instanceof TemporaryError) {
          retryInterval = retryIntervalFromResponse(err.response);
        }
        if (retryInterval <= 0) {
          retryInterval = strategy.initialInterval * Math.pow(strategy.exponent, attempt) * (1 - Math.random() * 0.25);
        }
        const d = Math.min(retryInterval, strategy.maxInterval);
        await delay(d);
        attempt++;
      }
    }
  }
  function retryIntervalFromResponse(res) {
    const retryAfterMsVal = res.headers.get("retry-after-ms");
    if (retryAfterMsVal) {
      const parsedMs = Number(retryAfterMsVal);
      if (Number.isFinite(parsedMs) && parsedMs >= 0) {
        return parsedMs;
      }
    }
    const retryVal = res.headers.get("retry-after") || "";
    if (!retryVal) {
      return 0;
    }
    const parsedNumber = Number(retryVal);
    if (Number.isInteger(parsedNumber)) {
      return parsedNumber * 1e3;
    }
    const parsedDate = Date.parse(retryVal);
    if (Number.isInteger(parsedDate)) {
      const deltaMS = parsedDate - Date.now();
      return deltaMS > 0 ? Math.ceil(deltaMS) : 0;
    }
    return 0;
  }
  async function delay(delay2) {
    return new Promise((resolve) => setTimeout(resolve, delay2));
  }
  var gt = typeof globalThis === "undefined" ? null : globalThis;
  var webWorkerLike = typeof gt === "object" && gt != null && "importScripts" in gt && typeof gt["importScripts"] === "function";
  var isBrowserLike = webWorkerLike || typeof navigator !== "undefined" && "serviceWorker" in navigator || typeof window === "object" && typeof window.document !== "undefined";
  var ClientSDK = class {
    constructor(options = {}) {
      const opt = options;
      if (typeof opt === "object" && opt != null && "hooks" in opt && opt.hooks instanceof SDKHooks) {
        this._hooks = opt.hooks;
      } else {
        this._hooks = new SDKHooks();
      }
      const defaultHttpClient = new HTTPClient();
      options.http_client = options.http_client || defaultHttpClient;
      options = this._hooks.sdkInit(options);
      const url = serverURLFromOptions(options);
      if (url) {
        url.pathname = url.pathname.replace(/\/+$/, "") + "/";
      }
      this._baseURL = url;
      this._httpClient = options.http_client || defaultHttpClient;
      this._options = Object.assign(Object.assign({}, fillGlobals(options)), { hooks: this._hooks });
      this._logger = this._options.debug_logger;
      if (!this._logger && env().GOOGLE_GENAI_DEBUG) {
        this._logger = console;
      }
    }
    _createRequest(context, conf, options) {
      var _a2, _b, _c, _d, _e;
      const { method, path, query, headers: opHeaders, security } = conf;
      const base = (_a2 = conf.baseURL) !== null && _a2 !== void 0 ? _a2 : this._baseURL;
      if (!base) {
        return ERR(new InvalidRequestError("No base URL provided for operation"));
      }
      const baseURL = new URL(base);
      let reqURL;
      if (path) {
        baseURL.pathname = baseURL.pathname.replace(/\/+$/, "") + "/";
        reqURL = new URL(path, baseURL);
        if (!reqURL.search && baseURL.search) {
          reqURL.search = baseURL.search;
        }
      } else {
        reqURL = baseURL;
      }
      reqURL.hash = "";
      const mergeQuery = (current, additions) => {
        if (!additions) {
          return current;
        }
        const additionKeys = new Set(additions.split("&").filter((pair) => pair !== "").map((pair) => {
          var _a3;
          return (_a3 = pair.split("=")[0]) !== null && _a3 !== void 0 ? _a3 : "";
        }));
        const kept = current.split("&").filter((pair) => {
          var _a3;
          return pair !== "" && !additionKeys.has((_a3 = pair.split("=")[0]) !== null && _a3 !== void 0 ? _a3 : "");
        });
        return [...kept, additions].join("&");
      };
      const encodeQueryRecord = (record) => {
        return Object.entries(record).map(([k, v]) => {
          if (v == null) {
            return void 0;
          }
          const value = isPlainObject$1(v) ? JSON.stringify(v) : v;
          return encodeForm(k, value, {
            explode: Array.isArray(value),
            charEncoding: "percent"
          });
        }).filter((pair) => typeof pair !== "undefined").join("&");
      };
      const finalQuery = [
        query || "",
        encodeQueryRecord((options === null || options === void 0 ? void 0 : options.extra_query) || {}),
        encodeQueryRecord((security === null || security === void 0 ? void 0 : security.queryParams) || {})
      ].reduce(mergeQuery, reqURL.search.slice(1));
      if (finalQuery) {
        reqURL.search = `?${finalQuery}`;
      }
      const headers = new Headers(opHeaders);
      const username = security === null || security === void 0 ? void 0 : security.basic.username;
      const password = security === null || security === void 0 ? void 0 : security.basic.password;
      if (username != null || password != null) {
        const encoded = stringToBase64([username || "", password || ""].join(":"));
        headers.set("Authorization", `Basic ${encoded}`);
      }
      const securityHeaders = new Headers((security === null || security === void 0 ? void 0 : security.headers) || {});
      for (const [k, v] of securityHeaders) {
        headers.set(k, v);
      }
      let cookie = headers.get("cookie") || "";
      for (const [k, v] of Object.entries((security === null || security === void 0 ? void 0 : security.cookies) || {})) {
        cookie += `; ${k}=${v}`;
      }
      cookie = cookie.startsWith("; ") ? cookie.slice(2) : cookie;
      headers.set("cookie", cookie);
      const userHeaders = new Headers((_b = options === null || options === void 0 ? void 0 : options.headers) !== null && _b !== void 0 ? _b : (_c = options === null || options === void 0 ? void 0 : options.fetch_options) === null || _c === void 0 ? void 0 : _c.headers);
      for (const [k, v] of userHeaders) {
        headers.set(k, v);
      }
      if (!isBrowserLike) {
        headers.set((_d = conf.uaHeader) !== null && _d !== void 0 ? _d : "user-agent", (_e = conf.userAgent) !== null && _e !== void 0 ? _e : SDK_METADATA.userAgent);
      }
      let reqBody = conf.body;
      const extraBody = Object.fromEntries(Object.entries((options === null || options === void 0 ? void 0 : options.extra_body) || {}).filter(([, v]) => typeof v !== "undefined"));
      if (Object.keys(extraBody).length > 0) {
        const contentType = new Headers(opHeaders).get("content-type") || "";
        const isJSON = /^(application|text)\/([^+]+\+)*json/.test(contentType);
        if (!isJSON || typeof reqBody !== "string" && reqBody != null) {
          return ERR(new InvalidRequestError("extra_body can only be merged into JSON object request bodies"));
        }
        let parsedBody;
        try {
          parsedBody = reqBody ? JSON.parse(reqBody) : {};
        } catch (err) {
          return ERR(new InvalidRequestError("extra_body can only be merged into JSON object request bodies", { cause: err }));
        }
        if (!isPlainObject$1(parsedBody)) {
          return ERR(new InvalidRequestError("extra_body can only be merged into JSON object request bodies"));
        }
        reqBody = JSON.stringify(Object.assign(Object.assign({}, parsedBody), extraBody));
        headers.delete("content-length");
      }
      const fetchOptions = Object.assign(Object.assign({}, options === null || options === void 0 ? void 0 : options.fetch_options), options);
      if (!(fetchOptions === null || fetchOptions === void 0 ? void 0 : fetchOptions.signal) && conf.timeout_ms != null && conf.timeout_ms > 0) {
        context.timeout_ms = conf.timeout_ms;
      }
      if (conf.body instanceof ReadableStream) {
        Object.assign(fetchOptions, { duplex: "half" });
      }
      let input;
      try {
        input = this._hooks.beforeCreateRequest(context, {
          url: reqURL,
          options: Object.assign(Object.assign({}, fetchOptions), {
            body: reqBody !== null && reqBody !== void 0 ? reqBody : null,
            headers,
            method
          })
        });
      } catch (err) {
        return ERR(new UnexpectedClientError("Create request hook failed to execute", {
          cause: err
        }));
      }
      return OK(new Request(input.url, input.options));
    }
    async _do(request, options) {
      const { context, isErrorStatusCode } = options;
      const timeout_ms = context.timeout_ms;
      return retry(async () => {
        var _a2;
        const cloned = request.clone();
        let attempt = cloned;
        if (timeout_ms != null && timeout_ms > 0) {
          const timeoutSignal = AbortSignal.timeout(timeout_ms);
          const combined = (_a2 = combineSignals(cloned.signal, timeoutSignal)) !== null && _a2 !== void 0 ? _a2 : timeoutSignal;
          attempt = new Request(cloned, { signal: combined });
        }
        const req = await this._hooks.beforeRequest(context, attempt);
        await logRequest(this._logger, req).catch((e) => {
          var _a3;
          return (_a3 = this._logger) === null || _a3 === void 0 ? void 0 : _a3.log("Failed to log request:", e);
        });
        let response = await this._httpClient.request(req);
        try {
          if (isErrorStatusCode(response.status)) {
            const result = await this._hooks.afterError(context, response, null);
            if (result.error) {
              throw result.error;
            }
            response = result.response || response;
          } else {
            response = await this._hooks.afterSuccess(context, response);
          }
        } finally {
          await logResponse(this._logger, response, req).catch((e) => {
            var _a3;
            return (_a3 = this._logger) === null || _a3 === void 0 ? void 0 : _a3.log("Failed to log response:", e);
          });
        }
        return response;
      }, { config: options.retryConfig, statusCodes: options.retryCodes }).then((r) => OK(r), (err) => {
        switch (true) {
          case isAbortError(err):
            return ERR(new RequestAbortedError("Request aborted by client", {
              cause: err
            }));
          case isTimeoutError(err):
            return ERR(new RequestTimeoutError("Request timed out", { cause: err }));
          case isConnectionError(err):
            return ERR(new ConnectionError("Unable to make request", { cause: err }));
          default:
            return ERR(new UnexpectedClientError("Unexpected HTTP client error", {
              cause: err
            }));
        }
      });
    }
  };
  var jsonLikeContentTypeRE = /^(application|text)\/([^+]+\+)*json.*/;
  var jsonlLikeContentTypeRE = /^(application|text)\/([^+]+\+)*(jsonl|x-ndjson)\b.*/;
  async function logRequest(logger, req) {
    if (!logger) {
      return;
    }
    const contentType = req.headers.get("content-type");
    const ct = (contentType === null || contentType === void 0 ? void 0 : contentType.split(";")[0]) || "";
    logger.group(`> Request: ${req.method} ${req.url}`);
    logger.group("Headers:");
    for (const [k, v] of req.headers.entries()) {
      logger.log(`${k}: ${v}`);
    }
    logger.groupEnd();
    logger.group("Body:");
    switch (true) {
      case jsonLikeContentTypeRE.test(ct):
        logger.log(await req.clone().json());
        break;
      case ct.startsWith("text/"):
        logger.log(await req.clone().text());
        break;
      case ct === "multipart/form-data": {
        const body = await req.clone().formData();
        for (const [k, v] of body) {
          const vlabel = v instanceof Blob ? "<Blob>" : v;
          logger.log(`${k}: ${vlabel}`);
        }
        break;
      }
      default:
        logger.log(`<${contentType}>`);
        break;
    }
    logger.groupEnd();
    logger.groupEnd();
  }
  async function logResponse(logger, res, req) {
    if (!logger) {
      return;
    }
    const contentType = res.headers.get("content-type");
    const ct = (contentType === null || contentType === void 0 ? void 0 : contentType.split(";")[0]) || "";
    logger.group(`< Response: ${req.method} ${req.url}`);
    logger.log("Status Code:", res.status, res.statusText);
    logger.group("Headers:");
    for (const [k, v] of res.headers.entries()) {
      logger.log(`${k}: ${v}`);
    }
    logger.groupEnd();
    logger.group("Body:");
    switch (true) {
      case (matchContentType(res, "application/json") || jsonLikeContentTypeRE.test(ct) && !jsonlLikeContentTypeRE.test(ct)):
        logger.log(await res.clone().json());
        break;
      case (matchContentType(res, "application/jsonl") || jsonlLikeContentTypeRE.test(ct)):
      case matchContentType(res, "text/event-stream"):
        logger.log(`<${contentType}>`);
        break;
      case matchContentType(res, "text/*"):
        logger.log(await res.clone().text());
        break;
      case matchContentType(res, "multipart/form-data"): {
        const body = await res.clone().formData();
        for (const [k, v] of body) {
          const vlabel = v instanceof Blob ? "<Blob>" : v;
          logger.log(`${k}: ${vlabel}`);
        }
        break;
      }
      default:
        logger.log(`<${contentType}>`);
        break;
    }
    logger.groupEnd();
    logger.groupEnd();
  }
  var GoogleGenAiDefaultError = class extends GoogleGenAiError {
    constructor(message, httpMeta) {
      if (message) {
        message += `: `;
      }
      message += `Status ${httpMeta.response.status}`;
      const contentType = httpMeta.response.headers.get("content-type") || `""`;
      if (contentType !== "application/json") {
        message += ` Content-Type ${contentType.includes(" ") ? `"${contentType}"` : contentType}`;
      }
      const body = httpMeta.body || `""`;
      message += body.length > 100 ? "\n" : ". ";
      let bodyDisplay = body;
      if (body.length > 1e4) {
        const truncated = body.substring(0, 1e4);
        const remaining = body.length - 1e4;
        bodyDisplay = `${truncated}...and ${remaining} more chars`;
      }
      message += `Body: ${bodyDisplay}`;
      message = message.trim();
      super(message, httpMeta);
      this.name = "GoogleGenAiDefaultError";
    }
  };
  function tryParseJson(s) {
    try {
      return JSON.parse(s);
    } catch (_a2) {
      return s;
    }
  }
  function wrapEventStreamResponse(body, opts = {}) {
    var _a2, _b;
    const flattened = opts.flattened === true;
    const sentinel = (_a2 = opts.sentinel) !== null && _a2 !== void 0 ? _a2 : "";
    return new Stream(body, (rawEvent) => {
      if (sentinel !== "" && rawEvent.data === sentinel) {
        return { done: true, value: void 0 };
      }
      if (flattened) {
        const data = rawEvent.data == null ? void 0 : tryParseJson(rawEvent.data);
        return { done: false, value: data };
      }
      return {
        done: false,
        value: Object.assign(Object.assign({}, rawEvent), { data: rawEvent.data == null ? rawEvent.data : tryParseJson(rawEvent.data) })
      };
    }, { dataRequired: (_b = opts.dataRequired) !== null && _b !== void 0 ? _b : true });
  }
  var Stream = class extends ReadableStream {
    constructor(responseBody, parse, opts) {
      var _a2;
      const upstream = responseBody.getReader();
      let buffer = new Uint8Array(4096);
      let bufferLen = 0;
      let searchStart = 0;
      const state = { eventId: void 0 };
      const dataRequired = (_a2 = opts === null || opts === void 0 ? void 0 : opts.dataRequired) !== null && _a2 !== void 0 ? _a2 : true;
      super({
        async pull(downstream) {
          try {
            while (true) {
              const match2 = findBoundary(buffer, bufferLen, searchStart);
              if (!match2) {
                searchStart = Math.max(0, bufferLen - MAX_BOUNDARY_LEN + 1);
                const chunk = await upstream.read();
                if (chunk.done)
                  return downstream.close();
                if (bufferLen + chunk.value.length > buffer.length) {
                  const grown = new Uint8Array(Math.max(buffer.length * 2, bufferLen + chunk.value.length));
                  grown.set(buffer.subarray(0, bufferLen));
                  buffer = grown;
                }
                buffer.set(chunk.value, bufferLen);
                bufferLen += chunk.value.length;
                continue;
              }
              const message = buffer.slice(0, match2.index);
              buffer.copyWithin(0, match2.index + match2.length, bufferLen);
              bufferLen -= match2.index + match2.length;
              if (buffer.length > 4096 && bufferLen <= buffer.length >> 2) {
                const shrunk = new Uint8Array(Math.max(4096, bufferLen * 2));
                shrunk.set(buffer.subarray(0, bufferLen));
                buffer = shrunk;
              }
              searchStart = 0;
              const item = parseMessage(message, parse, state, dataRequired);
              if (item && !item.done)
                return downstream.enqueue(item.value);
              if (item === null || item === void 0 ? void 0 : item.done) {
                await upstream.cancel("done");
                return downstream.close();
              }
            }
          } catch (e) {
            downstream.error(e);
            await upstream.cancel(e);
          }
        },
        cancel: (reason) => upstream.cancel(reason)
      });
    }
    [Symbol.asyncIterator](options) {
      const fn = ReadableStream.prototype[Symbol.asyncIterator];
      if (typeof fn === "function")
        return fn.call(this, options);
      const reader = this.getReader();
      const iterator = {
        next: async () => {
          const r = await reader.read();
          if (r.done) {
            reader.releaseLock();
            return { done: true, value: void 0 };
          }
          return { done: false, value: r.value };
        },
        throw: async (e) => {
          await reader.cancel(e);
          reader.releaseLock();
          return { done: true, value: void 0 };
        },
        return: async () => {
          await reader.cancel("done");
          reader.releaseLock();
          return { done: true, value: void 0 };
        },
        [Symbol.asyncIterator]() {
          return this;
        }
      };
      const asyncDispose = Symbol.asyncDispose;
      if (asyncDispose) {
        iterator[asyncDispose] = async () => {
          var _a2;
          await ((_a2 = iterator.return) === null || _a2 === void 0 ? void 0 : _a2.call(iterator));
        };
      }
      return iterator;
    }
    values(options) {
      return this[Symbol.asyncIterator](options);
    }
  };
  var CR = 13;
  var LF = 10;
  var BOUNDARIES = [
    [CR, LF, CR, LF],
    // \r\n\r\n
    [CR, LF, CR],
    // \r\n\r
    [CR, LF, LF],
    // \r\n\n
    [CR, CR, LF],
    // \r\r\n
    [LF, CR, LF],
    // \n\r\n
    [CR, CR],
    // \r\r
    [LF, CR],
    // \n\r
    [LF, LF]
    // \n\n
  ];
  var MAX_BOUNDARY_LEN = BOUNDARIES.reduce((m, b) => Math.max(m, b.length), 0);
  function findBoundary(buf, len, from) {
    for (let i = from; i < len; i++) {
      if (buf[i] !== CR && buf[i] !== LF)
        continue;
      for (const boundary of BOUNDARIES) {
        if (i + boundary.length > len)
          continue;
        let match2 = true;
        for (let j = 0; j < boundary.length; j++) {
          if (buf[i + j] !== boundary[j]) {
            match2 = false;
            break;
          }
        }
        if (match2)
          return { index: i, length: boundary.length };
      }
    }
    return null;
  }
  function parseMessage(chunk, parse, state, dataRequired) {
    const text = new TextDecoder().decode(chunk);
    const lines = text.split(/\r\n|\r|\n/);
    const dataLines = [];
    const ret = {};
    let ignore = true;
    for (const line of lines) {
      if (!line || line.startsWith(":"))
        continue;
      ignore = false;
      const i = line.indexOf(":");
      let field = line;
      let value = "";
      if (i > 0) {
        field = line.slice(0, i);
        value = line[i + 1] === " " ? line.slice(i + 2) : line.slice(i + 1);
      }
      if (field === "data")
        dataLines.push(value);
      else if (field === "event")
        ret.event = value;
      else if (field === "id" && !value.includes("\0"))
        state.eventId = value;
      else if (field === "retry" && /^\d+$/.test(value)) {
        ret.retry = Number(value);
      }
    }
    if (ignore)
      return;
    ret.id = state.eventId;
    if (dataLines.length)
      ret.data = dataLines.join("\n");
    else if (dataRequired)
      return;
    return parse(ret);
  }
  var DEFAULT_CONTENT_TYPES = {
    jsonl: "application/jsonl",
    json: "application/json",
    text: "text/plain",
    bytes: "application/octet-stream",
    stream: "application/octet-stream",
    sse: "text/event-stream",
    nil: "*",
    fail: "*"
  };
  function jsonErr(codes, errorClass, options) {
    return Object.assign(Object.assign({}, options), { err: true, enc: "json", codes, errorClass });
  }
  function json(codes, options) {
    return Object.assign(Object.assign({}, options), { enc: "json", codes });
  }
  function sse(codes, sse2, options) {
    return Object.assign(Object.assign(Object.assign({}, options), { enc: "sse", codes }), sse2 ? { sse: sse2 } : {});
  }
  function nil(codes, options) {
    return Object.assign(Object.assign({}, options), { enc: "nil", codes });
  }
  function fail(codes) {
    return { enc: "fail", codes };
  }
  function match(...matchers) {
    return async function matchFunc(response, request, options) {
      let raw;
      let matcher;
      for (const match2 of matchers) {
        const { codes } = match2;
        const ctpattern = "ctype" in match2 ? match2.ctype : DEFAULT_CONTENT_TYPES[match2.enc];
        if (ctpattern && matchResponse(response, codes, ctpattern)) {
          matcher = match2;
          break;
        } else if (!ctpattern && matchStatusCode(response, codes)) {
          matcher = match2;
          break;
        }
      }
      if (!matcher) {
        return [{
          ok: false,
          error: new GoogleGenAiDefaultError("Unexpected Status or Content-Type", {
            response,
            request,
            body: await response.text().catch(() => "")
          })
        }, raw];
      }
      const encoding = matcher.enc;
      let body = "";
      switch (encoding) {
        case "json":
          body = await response.text();
          try {
            raw = JSON.parse(body);
          } catch (err) {
            if (!("err" in matcher)) {
              throw err;
            }
            raw = body;
          }
          break;
        case "jsonl":
          raw = response.body;
          break;
        case "bytes":
          raw = new Uint8Array(await response.arrayBuffer());
          break;
        case "stream":
          raw = response.body;
          break;
        case "text":
          body = await response.text();
          raw = body;
          break;
        case "sse":
          if (response.body) {
            const sseOpts = "sse" in matcher && matcher.sse || {};
            raw = wrapEventStreamResponse(response.body, sseOpts);
          } else {
            raw = null;
          }
          break;
        case "nil":
          body = await response.text();
          raw = void 0;
          break;
        case "fail":
          body = await response.text();
          raw = body;
          break;
        default:
          throw new Error(`Unsupported response type: ${encoding}`);
      }
      if (matcher.enc === "fail") {
        return [{
          ok: false,
          error: new GoogleGenAiDefaultError("API error occurred", {
            request,
            response,
            body
          })
        }, raw];
      }
      const resultKey = matcher.key || (options === null || options === void 0 ? void 0 : options.resultKey);
      let data;
      const headersField = matcher.hdrs ? { headers: unpackHeaders(response.headers) } : null;
      if ("err" in matcher) {
        data = Object.assign(Object.assign(Object.assign({}, options === null || options === void 0 ? void 0 : options.extraFields), headersField), isPlainObject$1(raw) ? raw : null);
      } else if (resultKey) {
        data = Object.assign(Object.assign(Object.assign({}, options === null || options === void 0 ? void 0 : options.extraFields), headersField), { [resultKey]: raw });
      } else if (matcher.hdrs) {
        data = Object.assign(Object.assign(Object.assign({}, options === null || options === void 0 ? void 0 : options.extraFields), headersField), isPlainObject$1(raw) ? raw : null);
      } else {
        data = raw;
      }
      if ("err" in matcher) {
        const errValue = matcher.errorClass ? new matcher.errorClass(data, { request, response, body }) : data;
        return [{ ok: false, error: errValue }, raw];
      }
      return [{ ok: true, value: data }, raw];
    };
  }
  var headerValRE = /, */;
  function unpackHeaders(headers) {
    const out = {};
    for (const [k, v] of headers.entries()) {
      out[k] = v.split(headerValRE);
    }
    return out;
  }
  var SecurityErrorCode;
  (function(SecurityErrorCode2) {
    SecurityErrorCode2["Incomplete"] = "incomplete";
    SecurityErrorCode2["UnrecognisedSecurityType"] = "unrecognized_security_type";
  })(SecurityErrorCode || (SecurityErrorCode = {}));
  var SecurityError = class _SecurityError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
      this.name = "SecurityError";
    }
    static incomplete() {
      return new _SecurityError(SecurityErrorCode.Incomplete, "Security requirements not met in order to perform the operation");
    }
    static unrecognizedType(type) {
      return new _SecurityError(SecurityErrorCode.UnrecognisedSecurityType, `Unrecognised security type: ${type}`);
    }
  };
  function resolveSecurity(...options) {
    const state = {
      basic: {},
      headers: {},
      queryParams: {},
      cookies: {},
      oauth2: { type: "none" }
    };
    const option = options.find((opts) => {
      return opts.every((o) => {
        if (o.value == null) {
          return false;
        } else if (o.type === "http:basic") {
          return o.value.username != null || o.value.password != null;
        } else if (o.type === "http:custom") {
          return null;
        } else if (o.type === "oauth2:password") {
          return typeof o.value === "string" && !!o.value;
        } else if (o.type === "oauth2:client_credentials") {
          if (typeof o.value == "string") {
            return !!o.value;
          }
          return o.value.client_id != null || o.value.client_secret != null;
        } else if (typeof o.value === "string") {
          return !!o.value;
        } else {
          throw new Error(`Unrecognized security type: ${o.type} (value type: ${typeof o.value})`);
        }
      });
    });
    if (option == null) {
      return null;
    }
    option.forEach((spec) => {
      if (spec.value == null) {
        return;
      }
      const { type } = spec;
      switch (type) {
        case "apiKey:header":
          state.headers[spec.fieldName] = spec.value;
          break;
        case "apiKey:query":
          state.queryParams[spec.fieldName] = spec.value;
          break;
        case "apiKey:cookie":
          state.cookies[spec.fieldName] = spec.value;
          break;
        case "http:basic":
          applyBasic(state, spec);
          break;
        case "http:custom":
          break;
        case "http:bearer":
          applyBearer(state, spec);
          break;
        case "oauth2":
          applyBearer(state, spec);
          break;
        case "oauth2:password":
          applyBearer(state, spec);
          break;
        case "oauth2:client_credentials":
          break;
        case "openIdConnect":
          applyBearer(state, spec);
          break;
        default:
          throw SecurityError.unrecognizedType(type);
      }
    });
    return state;
  }
  function applyBasic(state, spec) {
    if (spec.value == null) {
      return;
    }
    state.basic = spec.value;
  }
  function applyBearer(state, spec) {
    if (typeof spec.value !== "string" || !spec.value) {
      return;
    }
    let value = spec.value;
    if (value.slice(0, 7).toLowerCase() !== "bearer ") {
      value = `Bearer ${value}`;
    }
    if (spec.fieldName !== void 0) {
      state.headers[spec.fieldName] = value;
    }
  }
  function resolveGlobalSecurity(security, allowedFields) {
    var _a2, _b;
    let inputs = [
      [
        {
          fieldName: "apiKey",
          type: "http:custom",
          value: (_a2 = security === null || security === void 0 ? void 0 : security.api_key) !== null && _a2 !== void 0 ? _a2 : env().GOOGLE_GENAI_API_KEY
        },
        {
          fieldName: "accessToken",
          type: "http:custom",
          value: (_b = security === null || security === void 0 ? void 0 : security.access_token) !== null && _b !== void 0 ? _b : env().GOOGLE_GENAI_ACCESS_TOKEN
        },
        {
          fieldName: "defaultHeaders",
          type: "http:custom",
          value: security === null || security === void 0 ? void 0 : security.default_headers
        }
      ]
    ];
    return resolveSecurity(...inputs);
  }
  async function extractSecurity(sec) {
    if (sec == null) {
      return;
    }
    return typeof sec === "function" ? sec() : sec;
  }
  var _a;
  var APIPromise = class _APIPromise {
    constructor(p, callSource) {
      this[_a] = "APIPromise";
      this._promise = p instanceof Promise ? p : Promise.resolve(p);
      this._unwrapped = p instanceof Promise ? null : Promise.resolve(p[0]);
      this._callSource = callSource !== null && callSource !== void 0 ? callSource : null;
    }
    _getUnwrapped() {
      var _b;
      return (_b = this._unwrapped) !== null && _b !== void 0 ? _b : this._unwrapped = this._promise.then(([value]) => value);
    }
    then(onfulfilled, onrejected) {
      return this._promise.then(onfulfilled ? ([value]) => onfulfilled(value) : void 0, onrejected);
    }
    catch(onrejected) {
      return this._getUnwrapped().catch(onrejected);
    }
    finally(onfinally) {
      return this._getUnwrapped().finally(onfinally);
    }
    $inspect() {
      return this._promise;
    }
    asResponse() {
      var _b;
      const src = (_b = this._callSource) !== null && _b !== void 0 ? _b : this._callSource = this._promise.then(([, call]) => call);
      return src.then((call) => {
        if (!call.response) {
          throw new Error("APIPromise.asResponse: response unavailable");
        }
        return call.response;
      });
    }
    async withResponse() {
      const [[data], response] = await Promise.all([
        this._promise,
        this.asResponse()
      ]);
      return { data, response };
    }
    _thenUnwrap(transform) {
      var _b;
      const data = this._promise.then(([value, call]) => [transform(value), call]);
      data.catch(() => {
      });
      return new _APIPromise(data, (_b = this._callSource) !== null && _b !== void 0 ? _b : void 0);
    }
  };
  _a = Symbol.toStringTag;
  function unwrapAsAPIPromise(p) {
    const inner = p.$inspect();
    const data = inner.then(([r, call]) => {
      if (!r.ok) {
        throw r.error;
      }
      return [r.value, call];
    });
    const callSource = inner.then(([r, call]) => {
      var _b;
      if (!r.ok && !((_b = call.response) === null || _b === void 0 ? void 0 : _b.ok)) {
        throw r.error;
      }
      return call;
    });
    data.catch(() => {
    });
    callSource.catch(() => {
    });
    return new APIPromise(data, callSource);
  }
  function agentsCreate(client, body, api_version, options) {
    return new APIPromise($do$e(client, body, api_version, options));
  }
  async function $do$e(client, body, api_version, options) {
    var _a2, _b, _c;
    const input = {
      body,
      api_version
    };
    const payload = input;
    const body$ = encodeJSON("body", payload.body, { explode: true });
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" })
    };
    const path = pathToFunc("/{api_version}/agents")(pathParams);
    const headers = new Headers(compactMap({
      "Content-Type": "application/json",
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "CreateAgent",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "POST",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body: body$,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function agentsDelete(client, id, api_version, options) {
    return new APIPromise($do$d(client, id, api_version, options));
  }
  async function $do$d(client, id, api_version, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/agents/{id}")(pathParams);
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "DeleteAgent",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "DELETE",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function agentsGet(client, id, api_version, options) {
    return new APIPromise($do$c(client, id, api_version, options));
  }
  async function $do$c(client, id, api_version, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/agents/{id}")(pathParams);
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "GetAgent",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "GET",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function agentsList(client, api_version, page_size, page_token, parent, options) {
    return new APIPromise($do$b(client, api_version, page_size, page_token, parent, options));
  }
  async function $do$b(client, api_version, page_size, page_token, parent, options) {
    var _a2, _b, _c;
    const input = {
      api_version,
      page_size,
      page_token,
      parent
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload === null || payload === void 0 ? void 0 : payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" })
    };
    const path = pathToFunc("/{api_version}/agents")(pathParams);
    const query = encodeFormQuery({
      "page_size": payload === null || payload === void 0 ? void 0 : payload.page_size,
      "page_token": payload === null || payload === void 0 ? void 0 : payload.page_token,
      "parent": payload === null || payload === void 0 ? void 0 : payload.parent
    });
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "ListAgents",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "GET",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      query,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  var Agents = class extends ClientSDK {
    /**
     * Creates a new Agent (Typed version for SDK).
     */
    create(params, options) {
      const { api_version } = params, body = __rest(params, ["api_version"]);
      return unwrapAsAPIPromise(agentsCreate(this, body, api_version, options));
    }
    /**
     * Lists all Agents.
     */
    list(params, options) {
      return unwrapAsAPIPromise(agentsList(this, params === null || params === void 0 ? void 0 : params.api_version, params === null || params === void 0 ? void 0 : params.page_size, params === null || params === void 0 ? void 0 : params.page_token, params === null || params === void 0 ? void 0 : params.parent, options));
    }
    /**
     * Gets a specific Agent.
     */
    get(id, params, options) {
      return unwrapAsAPIPromise(agentsGet(this, id, params === null || params === void 0 ? void 0 : params.api_version, options));
    }
    /**
     * Deletes an Agent.
     */
    delete(id, params, options) {
      return unwrapAsAPIPromise(agentsDelete(this, id, params === null || params === void 0 ? void 0 : params.api_version, options));
    }
  };
  var CancelInteractionByIdServerError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "CancelInteractionByIdServerError";
    }
  };
  var CancelInteractionByIdClientError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "CancelInteractionByIdClientError";
    }
  };
  var CreateInteractionServerError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "CreateInteractionServerError";
    }
  };
  var CreateInteractionClientError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "CreateInteractionClientError";
    }
  };
  var DeleteInteractionServerError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "DeleteInteractionServerError";
    }
  };
  var DeleteInteractionClientError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "DeleteInteractionClientError";
    }
  };
  var GetInteractionByIdServerError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "GetInteractionByIdServerError";
    }
  };
  var GetInteractionByIdClientError = class extends GoogleGenAiError {
    constructor(err, httpMeta) {
      var _a2;
      const message = ((_a2 = err.error) === null || _a2 === void 0 ? void 0 : _a2.message) || `API error occurred: ${JSON.stringify(err)}`;
      super(message, httpMeta);
      this.data$ = err;
      this.error = err.error;
      this.name = "GetInteractionByIdClientError";
    }
  };
  function interactionsCancel(client, id, api_version, options) {
    return new APIPromise($do$a(client, id, api_version, options));
  }
  async function $do$a(client, id, api_version, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/interactions/{id}/cancel")(pathParams);
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "cancelInteractionById",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "POST",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const responseFields = {
      httpMeta: { response, request: req }
    };
    const [result] = await match(json(200), jsonErr("4XX", CancelInteractionByIdClientError), jsonErr("5XX", CancelInteractionByIdServerError))(response, req, { extraFields: responseFields });
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function interactionsCreate(client, body, api_version, options) {
    return new APIPromise($do$9(client, body, api_version, options));
  }
  async function $do$9(client, body, api_version, options) {
    var _a2, _b, _c, _d;
    const input = {
      body,
      api_version
    };
    const payload = input;
    const body$ = encodeJSON("body", payload.body, { explode: true });
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" })
    };
    const path = pathToFunc("/{api_version}/interactions")(pathParams);
    const headers = new Headers(compactMap({
      "Content-Type": "application/json",
      Accept: ((_b = input === null || input === void 0 ? void 0 : input.body) === null || _b === void 0 ? void 0 : _b.stream) ? "text/event-stream" : "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_d = (_c = options === null || options === void 0 ? void 0 : options.server_url) !== null && _c !== void 0 ? _c : client._baseURL) !== null && _d !== void 0 ? _d : "",
      operation_id: "CreateInteraction",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "POST",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body: body$,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const responseFields = {
      httpMeta: { response, request: req }
    };
    const [result] = await match(json(200), sse(200, {
      sentinel: "[DONE]",
      flattened: true
    }), jsonErr("4XX", CreateInteractionClientError), jsonErr("5XX", CreateInteractionServerError))(response, req, { extraFields: responseFields });
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function interactionsDelete(client, id, api_version, options) {
    return new APIPromise($do$8(client, id, api_version, options));
  }
  async function $do$8(client, id, api_version, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/interactions/{id}")(pathParams);
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "deleteInteraction",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "DELETE",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const responseFields = {
      httpMeta: { response, request: req }
    };
    const [result] = await match(nil(200), jsonErr("4XX", DeleteInteractionClientError), jsonErr("5XX", DeleteInteractionServerError))(response, req, { extraFields: responseFields });
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function interactionsGet(client, id, stream, last_event_id, include_input, api_version, options) {
    return new APIPromise($do$7(client, id, stream, last_event_id, include_input, api_version, options));
  }
  async function $do$7(client, id, stream, last_event_id, include_input, api_version, options) {
    var _a2, _b, _c;
    const input = {
      id,
      stream,
      last_event_id,
      include_input,
      api_version
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/interactions/{id}")(pathParams);
    const query = encodeFormQuery({
      "include_input": payload.include_input,
      "last_event_id": payload.last_event_id,
      "stream": payload.stream
    });
    const headers = new Headers(compactMap({
      Accept: (input === null || input === void 0 ? void 0 : input.stream) ? "text/event-stream" : "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "getInteractionById",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "GET",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      query,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const responseFields = {
      httpMeta: { response, request: req }
    };
    const [result] = await match(json(200), sse(200, {
      sentinel: "[DONE]",
      flattened: true
    }), jsonErr("4XX", GetInteractionByIdClientError), jsonErr("5XX", GetInteractionByIdServerError))(response, req, { extraFields: responseFields });
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  var Interactions = class extends ClientSDK {
    create(params, options) {
      const { api_version } = params, body = __rest(params, ["api_version"]);
      return unwrapAsAPIPromise(interactionsCreate(this, body, api_version, options));
    }
    get(id, params, options) {
      return unwrapAsAPIPromise(interactionsGet(this, id, params === null || params === void 0 ? void 0 : params.stream, params === null || params === void 0 ? void 0 : params.last_event_id, params === null || params === void 0 ? void 0 : params.include_input, params === null || params === void 0 ? void 0 : params.api_version, options));
    }
    /**
     * Deleting an interaction
     *
     * @remarks
     * Deletes the interaction by id.
     */
    delete(id, params, options) {
      return unwrapAsAPIPromise(interactionsDelete(this, id, params === null || params === void 0 ? void 0 : params.api_version, options));
    }
    /**
     * Canceling an interaction
     *
     * @remarks
     * Cancels an interaction by id. This only applies to background interactions that are still running.
     */
    cancel(id, params, options) {
      return unwrapAsAPIPromise(interactionsCancel(this, id, params === null || params === void 0 ? void 0 : params.api_version, options));
    }
  };
  function webhooksCreate(client, body, api_version, options) {
    return new APIPromise($do$6(client, body, api_version, options));
  }
  async function $do$6(client, body, api_version, options) {
    var _a2, _b, _c;
    const input = {
      body,
      api_version
    };
    const payload = input;
    const body$ = encodeJSON("body", payload.body, { explode: true });
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" })
    };
    const path = pathToFunc("/{api_version}/webhooks")(pathParams);
    const headers = new Headers(compactMap({
      "Content-Type": "application/json",
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "CreateWebhook",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "POST",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body: body$,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function webhooksDelete(client, id, api_version, options) {
    return new APIPromise($do$5(client, id, api_version, options));
  }
  async function $do$5(client, id, api_version, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/webhooks/{id}")(pathParams);
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "DeleteWebhook",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "DELETE",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function webhooksGet(client, id, api_version, options) {
    return new APIPromise($do$4(client, id, api_version, options));
  }
  async function $do$4(client, id, api_version, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/webhooks/{id}")(pathParams);
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "GetWebhook",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "GET",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function webhooksList(client, api_version, page_size, page_token, options) {
    return new APIPromise($do$3(client, api_version, page_size, page_token, options));
  }
  async function $do$3(client, api_version, page_size, page_token, options) {
    var _a2, _b, _c;
    const input = {
      api_version,
      page_size,
      page_token
    };
    const payload = input;
    const body = null;
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload === null || payload === void 0 ? void 0 : payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" })
    };
    const path = pathToFunc("/{api_version}/webhooks")(pathParams);
    const query = encodeFormQuery({
      "page_size": payload === null || payload === void 0 ? void 0 : payload.page_size,
      "page_token": payload === null || payload === void 0 ? void 0 : payload.page_token
    });
    const headers = new Headers(compactMap({
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "ListWebhooks",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "GET",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      query,
      body,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function webhooksPing(client, id, api_version, body, options) {
    return new APIPromise($do$2(client, id, api_version, body, options));
  }
  async function $do$2(client, id, api_version, body, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version,
      body
    };
    const payload = input;
    const body$ = encodeJSON("body", payload.body, { explode: true });
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/webhooks/{id}:ping")(pathParams);
    const headers = new Headers(compactMap({
      "Content-Type": "application/json",
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "PingWebhook",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "POST",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body: body$,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function webhooksRotateSigningSecret(client, id, api_version, body, options) {
    return new APIPromise($do$1(client, id, api_version, body, options));
  }
  async function $do$1(client, id, api_version, body, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version,
      body
    };
    const payload = input;
    const body$ = encodeJSON("body", payload.body, { explode: true });
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/webhooks/{id}:rotateSigningSecret")(pathParams);
    const headers = new Headers(compactMap({
      "Content-Type": "application/json",
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "RotateSigningSecret",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "POST",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      body: body$,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  function webhooksUpdate(client, id, api_version, update_mask, body, options) {
    return new APIPromise($do(client, id, api_version, update_mask, body, options));
  }
  async function $do(client, id, api_version, update_mask, body, options) {
    var _a2, _b, _c;
    const input = {
      id,
      api_version,
      update_mask,
      body
    };
    const payload = input;
    const body$ = encodeJSON("body", payload.body, { explode: true });
    const pathParams = {
      api_version: encodeSimple("api_version", (_a2 = payload.api_version) !== null && _a2 !== void 0 ? _a2 : client._options.api_version, { explode: false, charEncoding: "percent" }),
      id: encodeSimple("id", payload.id, {
        explode: false,
        charEncoding: "percent"
      })
    };
    const path = pathToFunc("/{api_version}/webhooks/{id}")(pathParams);
    const query = encodeFormQuery({
      "update_mask": payload.update_mask
    });
    const headers = new Headers(compactMap({
      "Content-Type": "application/json",
      Accept: "application/json"
    }));
    const securityInput = await extractSecurity(client._options.security);
    const requestSecurity = resolveGlobalSecurity(securityInput);
    const context = {
      options: client._options,
      base_url: (_c = (_b = options === null || options === void 0 ? void 0 : options.server_url) !== null && _b !== void 0 ? _b : client._baseURL) !== null && _c !== void 0 ? _c : "",
      operation_id: "UpdateWebhook",
      o_auth2_scopes: null,
      resolved_security: requestSecurity,
      security_source: client._options.security,
      retry_config: (options === null || options === void 0 ? void 0 : options.retries) || client._options.retry_config || {
        strategy: "attempt-count-backoff",
        backoff: {
          initialInterval: 500,
          maxInterval: 8e3,
          exponent: 2,
          maxElapsedTime: 3e4
        },
        retryConnectionErrors: true,
        maxRetries: 4
      },
      retry_codes: (options === null || options === void 0 ? void 0 : options.retry_codes) || ["408", "409", "429", "5XX"]
    };
    const requestRes = client._createRequest(context, {
      security: requestSecurity,
      method: "PATCH",
      baseURL: options === null || options === void 0 ? void 0 : options.server_url,
      path,
      headers,
      query,
      body: body$,
      userAgent: client._options.user_agent,
      timeout_ms: (options === null || options === void 0 ? void 0 : options.timeout_ms) || client._options.timeout_ms || -1
    }, options);
    if (!requestRes.ok) {
      return [requestRes, { status: "invalid" }];
    }
    const req = requestRes.value;
    const doResult = await client._do(req, {
      context,
      isErrorStatusCode: (statusCode) => matchStatusCode({ status: statusCode }, ["4XX", "5XX"]),
      retryConfig: context.retry_config,
      retryCodes: context.retry_codes
    });
    if (!doResult.ok) {
      return [doResult, { status: "request-error", request: req }];
    }
    const response = doResult.value;
    const [result] = await match(fail("4XX"), fail("5XX"), json("default"))(response, req);
    if (!result.ok) {
      return [result, { status: "complete", request: req, response }];
    }
    return [result, { status: "complete", request: req, response }];
  }
  var Webhooks = class extends ClientSDK {
    /**
     * Creates a new Webhook.
     */
    create(params, options) {
      const { api_version } = params, body = __rest(params, ["api_version"]);
      return unwrapAsAPIPromise(webhooksCreate(this, body, api_version, options));
    }
    /**
     * Lists all Webhooks.
     */
    list(params, options) {
      return unwrapAsAPIPromise(webhooksList(this, params === null || params === void 0 ? void 0 : params.api_version, params === null || params === void 0 ? void 0 : params.page_size, params === null || params === void 0 ? void 0 : params.page_token, options));
    }
    /**
     * Gets a specific Webhook.
     */
    get(id, params, options) {
      return unwrapAsAPIPromise(webhooksGet(this, id, params === null || params === void 0 ? void 0 : params.api_version, options));
    }
    /**
     * Updates an existing Webhook.
     */
    update(id, params, options) {
      const _a2 = params !== null && params !== void 0 ? params : {}, { api_version, update_mask } = _a2, body$body = __rest(_a2, ["api_version", "update_mask"]);
      const body = params === void 0 || Object.keys(body$body).length === 0 ? void 0 : body$body;
      return unwrapAsAPIPromise(webhooksUpdate(this, id, api_version, update_mask, body, options));
    }
    /**
     * Deletes a Webhook.
     */
    delete(id, params, options) {
      return unwrapAsAPIPromise(webhooksDelete(this, id, params === null || params === void 0 ? void 0 : params.api_version, options));
    }
    /**
     * Generates a new signing secret for a Webhook.
     */
    rotateSigningSecret(id, api_version, body, options) {
      return unwrapAsAPIPromise(webhooksRotateSigningSecret(this, id, api_version, body, options));
    }
    /**
     * Sends a ping event to a Webhook.
     */
    ping(id, api_version, body, options) {
      return unwrapAsAPIPromise(webhooksPing(this, id, api_version, body, options));
    }
  };
  var GoogleGenAI$1 = class GoogleGenAI extends ClientSDK {
    get interactions() {
      var _a2;
      return (_a2 = this._interactions) !== null && _a2 !== void 0 ? _a2 : this._interactions = new Interactions(this._options);
    }
    get webhooks() {
      var _a2;
      return (_a2 = this._webhooks) !== null && _a2 !== void 0 ? _a2 : this._webhooks = new Webhooks(this._options);
    }
    get agents() {
      var _a2;
      return (_a2 = this._agents) !== null && _a2 !== void 0 ? _a2 : this._agents = new Agents(this._options);
    }
  };
  var LEGACY_LYRIA_MODELS = /* @__PURE__ */ new Set([
    "lyria-3-pro-preview",
    "lyria-3-clip-preview"
  ]);
  function getGoogleGenAIServerURL(parentClient) {
    const serverURL = parentClient.getBaseUrl();
    if (!serverURL) {
      throw new Error("Base URL must be set.");
    }
    return serverURL.replace(/\/+$/, "");
  }
  function getGoogleGenAIAPIVersion(parentClient) {
    const apiVersion = trimSlashes(parentClient.getApiVersion());
    const project = parentClient.getProject();
    const location2 = parentClient.getLocation();
    if (parentClient.isVertexAI() && apiVersion && project && location2) {
      return `${apiVersion}/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location2)}`;
    }
    return apiVersion;
  }
  function buildGoogleGenAIClient(parentClient, options = {}) {
    var _a2, _b, _c, _d;
    const sdk = new GoogleGenAI$1(Object.assign(Object.assign({}, options), { api_version: (_a2 = options.api_version) !== null && _a2 !== void 0 ? _a2 : getGoogleGenAIAPIVersion(parentClient), security: (_b = options.security) !== null && _b !== void 0 ? _b : new GoogleGenAISecurityProvider({
      defaultHeaders: (_c = parentClient.getDefaultHeaders) === null || _c === void 0 ? void 0 : _c.call(parentClient),
      getAuthHeaders: (url) => parentClient.getAuthHeaders(url)
    }), server_url: (_d = options.server_url) !== null && _d !== void 0 ? _d : getGoogleGenAIServerURL(parentClient) }));
    return sdk;
  }
  var GeminiNextGenInteractions = class {
    constructor(parentClient) {
      this.parentClient = parentClient;
    }
    async create(params, options) {
      const { api_version } = params, request = __rest(params, ["api_version"]);
      if (request.stream === true) {
        const response2 = await wrapSDKCall(() => this.getClient(api_version).interactions.create(Object.assign(Object.assign({}, request), { stream: true, api_version }), toGoogleGenAIRequestOptions(options, true)));
        return wrapStreamErrors(response2);
      }
      const response = await unwrapWithSdkHttpResponse(interactionsCreate(this.getClient(api_version), request, api_version, toGoogleGenAIRequestOptions(options)));
      return addOutputPropertiesIfInteraction(response);
    }
    async get(id, params = {}, options) {
      const { api_version, stream = false, last_event_id, include_input } = params !== null && params !== void 0 ? params : {};
      if (stream === true) {
        const response2 = await wrapSDKCall(() => this.getClient(api_version).interactions.get(id, { stream, last_event_id, include_input, api_version }, toGoogleGenAIRequestOptions(options, true)));
        return wrapStreamErrors(response2);
      }
      const response = await unwrapWithSdkHttpResponse(interactionsGet(this.getClient(api_version), id, stream, last_event_id, include_input, api_version, toGoogleGenAIRequestOptions(options)));
      return addOutputPropertiesIfInteraction(response);
    }
    async delete(id, params = {}, options) {
      return wrapSDKCall(() => this.getClient(params === null || params === void 0 ? void 0 : params.api_version).interactions.delete(id, { api_version: params === null || params === void 0 ? void 0 : params.api_version }, toGoogleGenAIRequestOptions(options)));
    }
    async cancel(id, params = {}, options) {
      return addOutputPropertiesIfInteraction(await unwrapWithSdkHttpResponse(interactionsCancel(this.getClient(params === null || params === void 0 ? void 0 : params.api_version), id, params === null || params === void 0 ? void 0 : params.api_version, toGoogleGenAIRequestOptions(options))));
    }
    getClient(apiVersion) {
      var _a2;
      if (apiVersion) {
        return buildGoogleGenAIClient(this.parentClient, {
          api_version: apiVersion
        });
      }
      (_a2 = this.sdk) !== null && _a2 !== void 0 ? _a2 : this.sdk = buildGoogleGenAIClient(this.parentClient);
      return this.sdk;
    }
  };
  var GeminiNextGenAgents = class {
    constructor(parentClient) {
      this.parentClient = parentClient;
    }
    async create(params = {}, options) {
      const _a2 = params !== null && params !== void 0 ? params : {}, { api_version } = _a2, body = __rest(_a2, ["api_version"]);
      return unwrapWithSdkHttpResponse(agentsCreate(this.getClient(api_version), body, api_version, toGoogleGenAIRequestOptions(options)));
    }
    async list(params = {}, options) {
      const { api_version, pageSize, pageToken, parent } = params !== null && params !== void 0 ? params : {};
      return unwrapWithSdkHttpResponse(agentsList(this.getClient(api_version), api_version, pageSize, pageToken, parent, toGoogleGenAIRequestOptions(options)));
    }
    async get(id, params = {}, options) {
      return unwrapWithSdkHttpResponse(agentsGet(this.getClient(params === null || params === void 0 ? void 0 : params.api_version), id, params === null || params === void 0 ? void 0 : params.api_version, toGoogleGenAIRequestOptions(options)));
    }
    async delete(id, params = {}, options) {
      return unwrapWithSdkHttpResponse(agentsDelete(this.getClient(params === null || params === void 0 ? void 0 : params.api_version), id, params === null || params === void 0 ? void 0 : params.api_version, toGoogleGenAIRequestOptions(options)));
    }
    getClient(apiVersion) {
      var _a2;
      if (apiVersion) {
        return buildGoogleGenAIClient(this.parentClient, {
          api_version: apiVersion
        });
      }
      (_a2 = this.sdk) !== null && _a2 !== void 0 ? _a2 : this.sdk = buildGoogleGenAIClient(this.parentClient);
      return this.sdk;
    }
  };
  var GeminiNextGenWebhooks = class {
    constructor(parentClient) {
      this.parentClient = parentClient;
    }
    async create(params, options) {
      const { api_version } = params, body = __rest(params, ["api_version"]);
      return unwrapWithSdkHttpResponse(webhooksCreate(this.getClient(), body, api_version, toGoogleGenAIRequestOptions(options)));
    }
    async list(params = {}, options) {
      const { api_version, page_size, page_token } = params !== null && params !== void 0 ? params : {};
      return unwrapWithSdkHttpResponse(webhooksList(this.getClient(), api_version, page_size, page_token, toGoogleGenAIRequestOptions(options)));
    }
    async get(id, params = {}, options) {
      return unwrapWithSdkHttpResponse(webhooksGet(this.getClient(), id, params === null || params === void 0 ? void 0 : params.api_version, toGoogleGenAIRequestOptions(options)));
    }
    async update(id, params = {}, options) {
      const _a2 = params !== null && params !== void 0 ? params : {}, { api_version, update_mask } = _a2, body = __rest(_a2, ["api_version", "update_mask"]);
      return unwrapWithSdkHttpResponse(webhooksUpdate(this.getClient(), id, api_version, update_mask, body, toGoogleGenAIRequestOptions(options)));
    }
    async delete(id, params = {}, options) {
      return unwrapWithSdkHttpResponse(webhooksDelete(this.getClient(), id, params === null || params === void 0 ? void 0 : params.api_version, toGoogleGenAIRequestOptions(options)));
    }
    async rotateSigningSecret(id, params = {}, options) {
      const _a2 = params !== null && params !== void 0 ? params : {}, { api_version } = _a2, body = __rest(_a2, ["api_version"]);
      return unwrapWithSdkHttpResponse(webhooksRotateSigningSecret(this.getClient(), id, api_version, body, toGoogleGenAIRequestOptions(options)));
    }
    async ping(id, params = void 0, options) {
      const { api_version, body } = params !== null && params !== void 0 ? params : {};
      return unwrapWithSdkHttpResponse(webhooksPing(this.getClient(), id, api_version, body, toGoogleGenAIRequestOptions(options)));
    }
    getClient() {
      var _a2;
      (_a2 = this.sdk) !== null && _a2 !== void 0 ? _a2 : this.sdk = buildGoogleGenAIClient(this.parentClient);
      return this.sdk;
    }
  };
  function trimSlashes(value) {
    return value.replace(/^\/+|\/+$/g, "");
  }
  function toGoogleGenAIRequestOptions(options, streaming = false) {
    var _a2, _b, _c, _d;
    if (!options && !streaming) {
      return void 0;
    }
    const _e = options !== null && options !== void 0 ? options : {}, { timeout, maxRetries, defaultBaseURL, query, body, fetchOptions } = _e, rest = __rest(_e, ["timeout", "maxRetries", "defaultBaseURL", "query", "body", "fetchOptions"]);
    const nextOptions = Object.assign({}, rest);
    if (isPlainObject(query)) {
      nextOptions.extra_query = query;
    } else {
      warnIgnoredOption("query", query);
    }
    if (isPlainObject(body)) {
      nextOptions.extra_body = body;
    } else {
      warnIgnoredOption("body", body);
    }
    const fetch_options = (_a2 = rest.fetch_options) !== null && _a2 !== void 0 ? _a2 : fetchOptions;
    if (fetch_options) {
      nextOptions.fetch_options = fetch_options;
    }
    const server_url = (_b = rest.server_url) !== null && _b !== void 0 ? _b : defaultBaseURL;
    if (server_url) {
      nextOptions.server_url = server_url;
    }
    const timeout_ms = (_c = rest.timeout_ms) !== null && _c !== void 0 ? _c : timeout;
    if (timeout_ms !== void 0) {
      nextOptions.timeout_ms = timeout_ms;
    }
    if (maxRetries !== void 0) {
      nextOptions.retries = {
        strategy: "attempt-count-backoff",
        retryConnectionErrors: true,
        maxRetries
      };
    }
    if (streaming) {
      const headers = new Headers((_d = nextOptions.headers) !== null && _d !== void 0 ? _d : fetch_options === null || fetch_options === void 0 ? void 0 : fetch_options.headers);
      headers.set("Accept", "text/event-stream");
      nextOptions.headers = headers;
    }
    return nextOptions;
  }
  function warnIgnoredOption(name, value) {
    if (value !== void 0 && value !== null) {
      console.warn(`GoogleGenAI.interactions: request option ${name} is not supported by the Google GenAI interactions bridge and will be ignored.`);
    }
  }
  async function unwrapWithSdkHttpResponse(promise) {
    const [result, call] = await promise.$inspect();
    if (!result.ok) {
      throw wrapSDKError(result.error);
    }
    return attachSdkHttpResponse(result.value, call);
  }
  async function wrapSDKCall(operation) {
    try {
      return await operation();
    } catch (error) {
      throw wrapSDKError(error);
    }
  }
  function wrapStreamErrors(stream) {
    const asyncIterable = stream;
    return new Proxy(stream, {
      get(target, property) {
        if (property !== Symbol.asyncIterator) {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return function wrappedAsyncIterator() {
          const iterator = asyncIterable[Symbol.asyncIterator]();
          return {
            async next(...args) {
              try {
                return await iterator.next(...args);
              } catch (error) {
                throw wrapSDKError(error);
              }
            },
            async return(value) {
              if (!iterator.return) {
                return { done: true, value };
              }
              try {
                return await iterator.return(value);
              } catch (error) {
                throw wrapSDKError(error);
              }
            },
            async throw(error) {
              if (!iterator.throw) {
                throw wrapSDKError(error);
              }
              try {
                return await iterator.throw(error);
              } catch (caught) {
                throw wrapSDKError(caught);
              }
            },
            [Symbol.asyncIterator]() {
              return this;
            }
          };
        };
      }
    });
  }
  function attachSdkHttpResponse(value, call) {
    if (!isPlainObject(value) || call.status !== "complete") {
      return value;
    }
    return Object.assign(Object.assign({}, value), { sdkHttpResponse: createSdkHttpResponse(call.response, value) });
  }
  function createSdkHttpResponse(response, parsedBody) {
    const headers = {};
    for (const [key, value] of response.headers.entries()) {
      headers[key] = value;
    }
    return {
      headers,
      responseInternal: response,
      json: async () => parsedBody
    };
  }
  function addOutputPropertiesIfInteraction(value) {
    const interaction = normalizeInteractionShape(value);
    if (!interaction) {
      return value;
    }
    return addOutputProperties(interaction);
  }
  function normalizeInteractionShape(value) {
    if (!isPlainObject(value)) {
      return void 0;
    }
    if (Array.isArray(value["steps"])) {
      return value;
    }
    if (isLegacyLyriaInteraction(value)) {
      const outputs = value["outputs"];
      if (Array.isArray(outputs)) {
        const { outputs: _outputs } = value, rest = __rest(value, ["outputs"]);
        return Object.assign(Object.assign({}, rest), { steps: [{ type: "model_output", content: outputs }] });
      }
    }
    return Object.assign(Object.assign({}, value), { steps: [] });
  }
  function isLegacyLyriaInteraction(value) {
    const model = value["model"];
    return typeof model === "string" && LEGACY_LYRIA_MODELS.has(model);
  }
  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function addOutputProperties(interaction) {
    var _a2, _b;
    const normalized = normalizeInteractionDates(interaction);
    const steps = (_a2 = normalized["steps"]) !== null && _a2 !== void 0 ? _a2 : [];
    const textParts = [];
    let collecting = false;
    outer: for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.type === "user_input") {
        break;
      }
      if (step.type !== "model_output" || !step.content) {
        if (collecting) {
          break;
        }
        continue;
      }
      const content = step.content;
      for (let j = content.length - 1; j >= 0; j--) {
        const item = content[j];
        if (item.type === "text") {
          collecting = true;
          textParts.push((_b = item.text) !== null && _b !== void 0 ? _b : "");
        } else if (collecting) {
          break outer;
        }
      }
    }
    let output_image;
    let output_audio;
    let output_video;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.type === "user_input") {
        break;
      }
      if (step.type === "model_output" && step.content) {
        for (let j = step.content.length - 1; j >= 0; j--) {
          const content = step.content[j];
          if (content.type === "image" && !output_image) {
            output_image = content;
          }
          if (content.type === "audio" && !output_audio) {
            output_audio = content;
          }
          if (content.type === "video" && !output_video) {
            output_video = content;
          }
        }
      }
    }
    const output_text = textParts.reverse().join("");
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, normalized), output_text && { output_text }), output_image ? { output_image } : {}), output_audio ? { output_audio } : {}), output_video ? { output_video } : {});
  }
  function normalizeInteractionDates(interaction) {
    return Object.assign(Object.assign({}, interaction), { created: normalizeDateLike(interaction["created"]), updated: normalizeDateLike(interaction["updated"]) });
  }
  function normalizeDateLike(value) {
    return value instanceof Date ? value.toISOString() : value;
  }
  function cancelTuningJobParametersToMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    return toObject;
  }
  function cancelTuningJobParametersToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    return toObject;
  }
  function cancelTuningJobResponseFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function cancelTuningJobResponseFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    return toObject;
  }
  function codeExecutionResultToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromOutcome = getValueByPath(fromObject, ["outcome"]);
    if (fromOutcome != null) {
      setValueByPath(toObject, ["outcome"], fromOutcome);
    }
    const fromOutput = getValueByPath(fromObject, ["output"]);
    if (fromOutput != null) {
      setValueByPath(toObject, ["output"], fromOutput);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function contentToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromParts = getValueByPath(fromObject, ["parts"]);
    if (fromParts != null) {
      let transformedList = fromParts;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return partToVertex(item);
        });
      }
      setValueByPath(toObject, ["parts"], transformedList);
    }
    const fromRole = getValueByPath(fromObject, ["role"]);
    if (fromRole != null) {
      setValueByPath(toObject, ["role"], fromRole);
    }
    return toObject;
  }
  function createTuningJobConfigToMldev(fromObject, parentObject, _rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["validationDataset"]) !== void 0) {
      throw new Error("validationDataset parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromTunedModelDisplayName = getValueByPath(fromObject, [
      "tunedModelDisplayName"
    ]);
    if (parentObject !== void 0 && fromTunedModelDisplayName != null) {
      setValueByPath(parentObject, ["displayName"], fromTunedModelDisplayName);
    }
    if (getValueByPath(fromObject, ["description"]) !== void 0) {
      throw new Error("description parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromEpochCount = getValueByPath(fromObject, ["epochCount"]);
    if (parentObject !== void 0 && fromEpochCount != null) {
      setValueByPath(parentObject, ["tuningTask", "hyperparameters", "epochCount"], fromEpochCount);
    }
    const fromLearningRateMultiplier = getValueByPath(fromObject, [
      "learningRateMultiplier"
    ]);
    if (fromLearningRateMultiplier != null) {
      setValueByPath(toObject, ["tuningTask", "hyperparameters", "learningRateMultiplier"], fromLearningRateMultiplier);
    }
    if (getValueByPath(fromObject, ["exportLastCheckpointOnly"]) !== void 0) {
      throw new Error("exportLastCheckpointOnly parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["preTunedModelCheckpointId"]) !== void 0) {
      throw new Error("preTunedModelCheckpointId parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["adapterSize"]) !== void 0) {
      throw new Error("adapterSize parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["tuningMode"]) !== void 0) {
      throw new Error("tuningMode parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["customBaseModel"]) !== void 0) {
      throw new Error("customBaseModel parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromBatchSize = getValueByPath(fromObject, ["batchSize"]);
    if (parentObject !== void 0 && fromBatchSize != null) {
      setValueByPath(parentObject, ["tuningTask", "hyperparameters", "batchSize"], fromBatchSize);
    }
    const fromLearningRate = getValueByPath(fromObject, ["learningRate"]);
    if (parentObject !== void 0 && fromLearningRate != null) {
      setValueByPath(parentObject, ["tuningTask", "hyperparameters", "learningRate"], fromLearningRate);
    }
    if (getValueByPath(fromObject, ["labels"]) !== void 0) {
      throw new Error("labels parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["beta"]) !== void 0) {
      throw new Error("beta parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["baseTeacherModel"]) !== void 0) {
      throw new Error("baseTeacherModel parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["tunedTeacherModelSource"]) !== void 0) {
      throw new Error("tunedTeacherModelSource parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["sftLossWeightMultiplier"]) !== void 0) {
      throw new Error("sftLossWeightMultiplier parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["outputUri"]) !== void 0) {
      throw new Error("outputUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["encryptionSpec"]) !== void 0) {
      throw new Error("encryptionSpec parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["rewardConfig"]) !== void 0) {
      throw new Error("rewardConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["compositeRewardConfig"]) !== void 0) {
      throw new Error("compositeRewardConfig parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["samplesPerPrompt"]) !== void 0) {
      throw new Error("samplesPerPrompt parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["evaluateInterval"]) !== void 0) {
      throw new Error("evaluateInterval parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["checkpointInterval"]) !== void 0) {
      throw new Error("checkpointInterval parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["maxOutputTokens"]) !== void 0) {
      throw new Error("maxOutputTokens parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["thinkingLevel"]) !== void 0) {
      throw new Error("thinkingLevel parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["validationDatasetUri"]) !== void 0) {
      throw new Error("validationDatasetUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    return toObject;
  }
  function createTuningJobConfigToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    let discriminatorValidationDataset = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorValidationDataset === void 0) {
      discriminatorValidationDataset = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorValidationDataset === "SUPERVISED_FINE_TUNING") {
      const fromValidationDataset = getValueByPath(fromObject, [
        "validationDataset"
      ]);
      if (parentObject !== void 0 && fromValidationDataset != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec"], tuningValidationDatasetToVertex(fromValidationDataset));
      }
    } else if (discriminatorValidationDataset === "PREFERENCE_TUNING") {
      const fromValidationDataset = getValueByPath(fromObject, [
        "validationDataset"
      ]);
      if (parentObject !== void 0 && fromValidationDataset != null) {
        setValueByPath(parentObject, ["preferenceOptimizationSpec"], tuningValidationDatasetToVertex(fromValidationDataset));
      }
    } else if (discriminatorValidationDataset === "DISTILLATION") {
      const fromValidationDataset = getValueByPath(fromObject, [
        "validationDataset"
      ]);
      if (parentObject !== void 0 && fromValidationDataset != null) {
        setValueByPath(parentObject, ["distillationSpec"], tuningValidationDatasetToVertex(fromValidationDataset));
      }
    } else if (discriminatorValidationDataset === "REINFORCEMENT_TUNING") {
      const fromValidationDataset = getValueByPath(fromObject, [
        "validationDataset"
      ]);
      if (parentObject !== void 0 && fromValidationDataset != null) {
        setValueByPath(parentObject, ["reinforcementTuningSpec"], tuningValidationDatasetToVertex(fromValidationDataset));
      }
    }
    const fromTunedModelDisplayName = getValueByPath(fromObject, [
      "tunedModelDisplayName"
    ]);
    if (parentObject !== void 0 && fromTunedModelDisplayName != null) {
      setValueByPath(parentObject, ["tunedModelDisplayName"], fromTunedModelDisplayName);
    }
    const fromDescription = getValueByPath(fromObject, ["description"]);
    if (parentObject !== void 0 && fromDescription != null) {
      setValueByPath(parentObject, ["description"], fromDescription);
    }
    let discriminatorEpochCount = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorEpochCount === void 0) {
      discriminatorEpochCount = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorEpochCount === "SUPERVISED_FINE_TUNING") {
      const fromEpochCount = getValueByPath(fromObject, ["epochCount"]);
      if (parentObject !== void 0 && fromEpochCount != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "hyperParameters", "epochCount"], fromEpochCount);
      }
    } else if (discriminatorEpochCount === "PREFERENCE_TUNING") {
      const fromEpochCount = getValueByPath(fromObject, ["epochCount"]);
      if (parentObject !== void 0 && fromEpochCount != null) {
        setValueByPath(parentObject, ["preferenceOptimizationSpec", "hyperParameters", "epochCount"], fromEpochCount);
      }
    } else if (discriminatorEpochCount === "DISTILLATION") {
      const fromEpochCount = getValueByPath(fromObject, ["epochCount"]);
      if (parentObject !== void 0 && fromEpochCount != null) {
        setValueByPath(parentObject, ["distillationSpec", "hyperParameters", "epochCount"], fromEpochCount);
      }
    } else if (discriminatorEpochCount === "REINFORCEMENT_TUNING") {
      const fromEpochCount = getValueByPath(fromObject, ["epochCount"]);
      if (parentObject !== void 0 && fromEpochCount != null) {
        setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "epochCount"], fromEpochCount);
      }
    }
    let discriminatorLearningRateMultiplier = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorLearningRateMultiplier === void 0) {
      discriminatorLearningRateMultiplier = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorLearningRateMultiplier === "SUPERVISED_FINE_TUNING") {
      const fromLearningRateMultiplier = getValueByPath(fromObject, [
        "learningRateMultiplier"
      ]);
      if (parentObject !== void 0 && fromLearningRateMultiplier != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "hyperParameters", "learningRateMultiplier"], fromLearningRateMultiplier);
      }
    } else if (discriminatorLearningRateMultiplier === "PREFERENCE_TUNING") {
      const fromLearningRateMultiplier = getValueByPath(fromObject, [
        "learningRateMultiplier"
      ]);
      if (parentObject !== void 0 && fromLearningRateMultiplier != null) {
        setValueByPath(parentObject, [
          "preferenceOptimizationSpec",
          "hyperParameters",
          "learningRateMultiplier"
        ], fromLearningRateMultiplier);
      }
    } else if (discriminatorLearningRateMultiplier === "DISTILLATION") {
      const fromLearningRateMultiplier = getValueByPath(fromObject, [
        "learningRateMultiplier"
      ]);
      if (parentObject !== void 0 && fromLearningRateMultiplier != null) {
        setValueByPath(parentObject, ["distillationSpec", "hyperParameters", "learningRateMultiplier"], fromLearningRateMultiplier);
      }
    } else if (discriminatorLearningRateMultiplier === "REINFORCEMENT_TUNING") {
      const fromLearningRateMultiplier = getValueByPath(fromObject, [
        "learningRateMultiplier"
      ]);
      if (parentObject !== void 0 && fromLearningRateMultiplier != null) {
        setValueByPath(parentObject, [
          "reinforcementTuningSpec",
          "hyperParameters",
          "learningRateMultiplier"
        ], fromLearningRateMultiplier);
      }
    }
    let discriminatorExportLastCheckpointOnly = getValueByPath(rootObject, ["config", "method"]);
    if (discriminatorExportLastCheckpointOnly === void 0) {
      discriminatorExportLastCheckpointOnly = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorExportLastCheckpointOnly === "SUPERVISED_FINE_TUNING") {
      const fromExportLastCheckpointOnly = getValueByPath(fromObject, [
        "exportLastCheckpointOnly"
      ]);
      if (parentObject !== void 0 && fromExportLastCheckpointOnly != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "exportLastCheckpointOnly"], fromExportLastCheckpointOnly);
      }
    } else if (discriminatorExportLastCheckpointOnly === "PREFERENCE_TUNING") {
      const fromExportLastCheckpointOnly = getValueByPath(fromObject, [
        "exportLastCheckpointOnly"
      ]);
      if (parentObject !== void 0 && fromExportLastCheckpointOnly != null) {
        setValueByPath(parentObject, ["preferenceOptimizationSpec", "exportLastCheckpointOnly"], fromExportLastCheckpointOnly);
      }
    } else if (discriminatorExportLastCheckpointOnly === "DISTILLATION") {
      const fromExportLastCheckpointOnly = getValueByPath(fromObject, [
        "exportLastCheckpointOnly"
      ]);
      if (parentObject !== void 0 && fromExportLastCheckpointOnly != null) {
        setValueByPath(parentObject, ["distillationSpec", "exportLastCheckpointOnly"], fromExportLastCheckpointOnly);
      }
    }
    let discriminatorAdapterSize = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorAdapterSize === void 0) {
      discriminatorAdapterSize = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorAdapterSize === "SUPERVISED_FINE_TUNING") {
      const fromAdapterSize = getValueByPath(fromObject, ["adapterSize"]);
      if (parentObject !== void 0 && fromAdapterSize != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "hyperParameters", "adapterSize"], fromAdapterSize);
      }
    } else if (discriminatorAdapterSize === "PREFERENCE_TUNING") {
      const fromAdapterSize = getValueByPath(fromObject, ["adapterSize"]);
      if (parentObject !== void 0 && fromAdapterSize != null) {
        setValueByPath(parentObject, ["preferenceOptimizationSpec", "hyperParameters", "adapterSize"], fromAdapterSize);
      }
    } else if (discriminatorAdapterSize === "DISTILLATION") {
      const fromAdapterSize = getValueByPath(fromObject, ["adapterSize"]);
      if (parentObject !== void 0 && fromAdapterSize != null) {
        setValueByPath(parentObject, ["distillationSpec", "hyperParameters", "adapterSize"], fromAdapterSize);
      }
    } else if (discriminatorAdapterSize === "REINFORCEMENT_TUNING") {
      const fromAdapterSize = getValueByPath(fromObject, ["adapterSize"]);
      if (parentObject !== void 0 && fromAdapterSize != null) {
        setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "adapterSize"], fromAdapterSize);
      }
    }
    let discriminatorTuningMode = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorTuningMode === void 0) {
      discriminatorTuningMode = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorTuningMode === "SUPERVISED_FINE_TUNING") {
      const fromTuningMode = getValueByPath(fromObject, ["tuningMode"]);
      if (parentObject !== void 0 && fromTuningMode != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "tuningMode"], fromTuningMode);
      }
    } else if (discriminatorTuningMode === "DISTILLATION") {
      const fromTuningMode = getValueByPath(fromObject, ["tuningMode"]);
      if (parentObject !== void 0 && fromTuningMode != null) {
        setValueByPath(parentObject, ["distillationSpec", "tuningMode"], fromTuningMode);
      }
    }
    const fromCustomBaseModel = getValueByPath(fromObject, [
      "customBaseModel"
    ]);
    if (parentObject !== void 0 && fromCustomBaseModel != null) {
      setValueByPath(parentObject, ["customBaseModel"], fromCustomBaseModel);
    }
    let discriminatorBatchSize = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorBatchSize === void 0) {
      discriminatorBatchSize = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorBatchSize === "SUPERVISED_FINE_TUNING") {
      const fromBatchSize = getValueByPath(fromObject, ["batchSize"]);
      if (parentObject !== void 0 && fromBatchSize != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "hyperParameters", "batchSize"], fromBatchSize);
      }
    } else if (discriminatorBatchSize === "DISTILLATION") {
      const fromBatchSize = getValueByPath(fromObject, ["batchSize"]);
      if (parentObject !== void 0 && fromBatchSize != null) {
        setValueByPath(parentObject, ["distillationSpec", "hyperParameters", "batchSize"], fromBatchSize);
      }
    } else if (discriminatorBatchSize === "REINFORCEMENT_TUNING") {
      const fromBatchSize = getValueByPath(fromObject, ["batchSize"]);
      if (parentObject !== void 0 && fromBatchSize != null) {
        setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "batchSize"], fromBatchSize);
      }
    }
    let discriminatorLearningRate = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorLearningRate === void 0) {
      discriminatorLearningRate = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorLearningRate === "SUPERVISED_FINE_TUNING") {
      const fromLearningRate = getValueByPath(fromObject, [
        "learningRate"
      ]);
      if (parentObject !== void 0 && fromLearningRate != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "hyperParameters", "learningRate"], fromLearningRate);
      }
    } else if (discriminatorLearningRate === "DISTILLATION") {
      const fromLearningRate = getValueByPath(fromObject, [
        "learningRate"
      ]);
      if (parentObject !== void 0 && fromLearningRate != null) {
        setValueByPath(parentObject, ["distillationSpec", "hyperParameters", "learningRate"], fromLearningRate);
      }
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (parentObject !== void 0 && fromLabels != null) {
      setValueByPath(parentObject, ["labels"], fromLabels);
    }
    const fromBeta = getValueByPath(fromObject, ["beta"]);
    if (parentObject !== void 0 && fromBeta != null) {
      setValueByPath(parentObject, ["preferenceOptimizationSpec", "hyperParameters", "beta"], fromBeta);
    }
    const fromBaseTeacherModel = getValueByPath(fromObject, [
      "baseTeacherModel"
    ]);
    if (parentObject !== void 0 && fromBaseTeacherModel != null) {
      setValueByPath(parentObject, ["distillationSpec", "baseTeacherModel"], fromBaseTeacherModel);
    }
    const fromTunedTeacherModelSource = getValueByPath(fromObject, [
      "tunedTeacherModelSource"
    ]);
    if (parentObject !== void 0 && fromTunedTeacherModelSource != null) {
      setValueByPath(parentObject, ["distillationSpec", "tunedTeacherModelSource"], fromTunedTeacherModelSource);
    }
    const fromSftLossWeightMultiplier = getValueByPath(fromObject, [
      "sftLossWeightMultiplier"
    ]);
    if (parentObject !== void 0 && fromSftLossWeightMultiplier != null) {
      setValueByPath(parentObject, ["distillationSpec", "hyperParameters", "sftLossWeightMultiplier"], fromSftLossWeightMultiplier);
    }
    const fromOutputUri = getValueByPath(fromObject, ["outputUri"]);
    if (parentObject !== void 0 && fromOutputUri != null) {
      setValueByPath(parentObject, ["outputUri"], fromOutputUri);
    }
    const fromEncryptionSpec = getValueByPath(fromObject, [
      "encryptionSpec"
    ]);
    if (parentObject !== void 0 && fromEncryptionSpec != null) {
      setValueByPath(parentObject, ["encryptionSpec"], fromEncryptionSpec);
    }
    const fromRewardConfig = getValueByPath(fromObject, ["rewardConfig"]);
    if (parentObject !== void 0 && fromRewardConfig != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "singleRewardConfig"], fromRewardConfig);
    }
    const fromCompositeRewardConfig = getValueByPath(fromObject, [
      "compositeRewardConfig"
    ]);
    if (parentObject !== void 0 && fromCompositeRewardConfig != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "compositeRewardConfig"], fromCompositeRewardConfig);
    }
    const fromSamplesPerPrompt = getValueByPath(fromObject, [
      "samplesPerPrompt"
    ]);
    if (parentObject !== void 0 && fromSamplesPerPrompt != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "samplesPerPrompt"], fromSamplesPerPrompt);
    }
    const fromEvaluateInterval = getValueByPath(fromObject, [
      "evaluateInterval"
    ]);
    if (parentObject !== void 0 && fromEvaluateInterval != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "evaluateInterval"], fromEvaluateInterval);
    }
    const fromCheckpointInterval = getValueByPath(fromObject, [
      "checkpointInterval"
    ]);
    if (parentObject !== void 0 && fromCheckpointInterval != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "checkpointInterval"], fromCheckpointInterval);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (parentObject !== void 0 && fromMaxOutputTokens != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromThinkingLevel = getValueByPath(fromObject, [
      "thinkingLevel"
    ]);
    if (parentObject !== void 0 && fromThinkingLevel != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "hyperParameters", "thinkingLevel"], fromThinkingLevel);
    }
    const fromValidationDatasetUri = getValueByPath(fromObject, [
      "validationDatasetUri"
    ]);
    if (parentObject !== void 0 && fromValidationDatasetUri != null) {
      setValueByPath(parentObject, ["reinforcementTuningSpec", "validationDatasetUri"], fromValidationDatasetUri);
    }
    return toObject;
  }
  function createTuningJobParametersPrivateToMldev(fromObject, rootObject) {
    const toObject = {};
    const fromBaseModel = getValueByPath(fromObject, ["baseModel"]);
    if (fromBaseModel != null) {
      setValueByPath(toObject, ["baseModel"], fromBaseModel);
    }
    const fromPreTunedModel = getValueByPath(fromObject, [
      "preTunedModel"
    ]);
    if (fromPreTunedModel != null) {
      setValueByPath(toObject, ["preTunedModel"], fromPreTunedModel);
    }
    const fromTrainingDataset = getValueByPath(fromObject, [
      "trainingDataset"
    ]);
    if (fromTrainingDataset != null) {
      tuningDatasetToMldev(fromTrainingDataset);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createTuningJobConfigToMldev(fromConfig, toObject);
    }
    return toObject;
  }
  function createTuningJobParametersPrivateToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromBaseModel = getValueByPath(fromObject, ["baseModel"]);
    if (fromBaseModel != null) {
      setValueByPath(toObject, ["baseModel"], fromBaseModel);
    }
    const fromPreTunedModel = getValueByPath(fromObject, [
      "preTunedModel"
    ]);
    if (fromPreTunedModel != null) {
      setValueByPath(toObject, ["preTunedModel"], fromPreTunedModel);
    }
    const fromTrainingDataset = getValueByPath(fromObject, [
      "trainingDataset"
    ]);
    if (fromTrainingDataset != null) {
      tuningDatasetToVertex(fromTrainingDataset, toObject, rootObject);
    }
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      createTuningJobConfigToVertex(fromConfig, toObject, rootObject);
    }
    return toObject;
  }
  function distillationHyperParametersFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromAdapterSize = getValueByPath(fromObject, ["adapterSize"]);
    if (fromAdapterSize != null) {
      setValueByPath(toObject, ["adapterSize"], fromAdapterSize);
    }
    const fromEpochCount = getValueByPath(fromObject, ["epochCount"]);
    if (fromEpochCount != null) {
      setValueByPath(toObject, ["epochCount"], fromEpochCount);
    }
    const fromLearningRateMultiplier = getValueByPath(fromObject, [
      "learningRateMultiplier"
    ]);
    if (fromLearningRateMultiplier != null) {
      setValueByPath(toObject, ["learningRateMultiplier"], fromLearningRateMultiplier);
    }
    const fromGenerationConfig = getValueByPath(fromObject, [
      "generationConfig"
    ]);
    if (fromGenerationConfig != null) {
      setValueByPath(toObject, ["generationConfig"], generationConfigFromVertex(fromGenerationConfig));
    }
    const fromLearningRate = getValueByPath(fromObject, ["learningRate"]);
    if (fromLearningRate != null) {
      setValueByPath(toObject, ["learningRate"], fromLearningRate);
    }
    const fromBatchSize = getValueByPath(fromObject, ["batchSize"]);
    if (fromBatchSize != null) {
      setValueByPath(toObject, ["batchSize"], fromBatchSize);
    }
    return toObject;
  }
  function distillationSamplingSpecFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromBaseTeacherModel = getValueByPath(fromObject, [
      "baseTeacherModel"
    ]);
    if (fromBaseTeacherModel != null) {
      setValueByPath(toObject, ["baseTeacherModel"], fromBaseTeacherModel);
    }
    const fromTunedTeacherModelSource = getValueByPath(fromObject, [
      "tunedTeacherModelSource"
    ]);
    if (fromTunedTeacherModelSource != null) {
      setValueByPath(toObject, ["tunedTeacherModelSource"], fromTunedTeacherModelSource);
    }
    const fromValidationDatasetUri = getValueByPath(fromObject, [
      "validationDatasetUri"
    ]);
    if (fromValidationDatasetUri != null) {
      setValueByPath(toObject, ["validationDatasetUri"], fromValidationDatasetUri);
    }
    const fromPromptDatasetUri = getValueByPath(fromObject, [
      "promptDatasetUri"
    ]);
    if (fromPromptDatasetUri != null) {
      setValueByPath(toObject, ["promptDatasetUri"], fromPromptDatasetUri);
    }
    const fromHyperparameters = getValueByPath(fromObject, [
      "hyperparameters"
    ]);
    if (fromHyperparameters != null) {
      setValueByPath(toObject, ["hyperparameters"], distillationHyperParametersFromVertex(fromHyperparameters));
    }
    return toObject;
  }
  function distillationSpecFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromPromptDatasetUri = getValueByPath(fromObject, [
      "promptDatasetUri"
    ]);
    if (fromPromptDatasetUri != null) {
      setValueByPath(toObject, ["promptDatasetUri"], fromPromptDatasetUri);
    }
    const fromBaseTeacherModel = getValueByPath(fromObject, [
      "baseTeacherModel"
    ]);
    if (fromBaseTeacherModel != null) {
      setValueByPath(toObject, ["baseTeacherModel"], fromBaseTeacherModel);
    }
    const fromHyperParameters = getValueByPath(fromObject, [
      "hyperParameters"
    ]);
    if (fromHyperParameters != null) {
      setValueByPath(toObject, ["hyperParameters"], distillationHyperParametersFromVertex(fromHyperParameters));
    }
    const fromPipelineRootDirectory = getValueByPath(fromObject, [
      "pipelineRootDirectory"
    ]);
    if (fromPipelineRootDirectory != null) {
      setValueByPath(toObject, ["pipelineRootDirectory"], fromPipelineRootDirectory);
    }
    const fromStudentModel = getValueByPath(fromObject, ["studentModel"]);
    if (fromStudentModel != null) {
      setValueByPath(toObject, ["studentModel"], fromStudentModel);
    }
    const fromTrainingDatasetUri = getValueByPath(fromObject, [
      "trainingDatasetUri"
    ]);
    if (fromTrainingDatasetUri != null) {
      setValueByPath(toObject, ["trainingDatasetUri"], fromTrainingDatasetUri);
    }
    const fromTunedTeacherModelSource = getValueByPath(fromObject, [
      "tunedTeacherModelSource"
    ]);
    if (fromTunedTeacherModelSource != null) {
      setValueByPath(toObject, ["tunedTeacherModelSource"], fromTunedTeacherModelSource);
    }
    const fromValidationDatasetUri = getValueByPath(fromObject, [
      "validationDatasetUri"
    ]);
    if (fromValidationDatasetUri != null) {
      setValueByPath(toObject, ["validationDatasetUri"], fromValidationDatasetUri);
    }
    const fromTuningMode = getValueByPath(fromObject, ["tuningMode"]);
    if (fromTuningMode != null) {
      setValueByPath(toObject, ["tuningMode"], fromTuningMode);
    }
    return toObject;
  }
  function executableCodeToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromCode = getValueByPath(fromObject, ["code"]);
    if (fromCode != null) {
      setValueByPath(toObject, ["code"], fromCode);
    }
    const fromLanguage = getValueByPath(fromObject, ["language"]);
    if (fromLanguage != null) {
      setValueByPath(toObject, ["language"], fromLanguage);
    }
    if (getValueByPath(fromObject, ["id"]) !== void 0) {
      throw new Error("id parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function generationConfigFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromModelSelectionConfig = getValueByPath(fromObject, [
      "modelConfig"
    ]);
    if (fromModelSelectionConfig != null) {
      setValueByPath(toObject, ["modelSelectionConfig"], fromModelSelectionConfig);
    }
    const fromResponseJsonSchema = getValueByPath(fromObject, [
      "responseJsonSchema"
    ]);
    if (fromResponseJsonSchema != null) {
      setValueByPath(toObject, ["responseJsonSchema"], fromResponseJsonSchema);
    }
    const fromAudioTimestamp = getValueByPath(fromObject, [
      "audioTimestamp"
    ]);
    if (fromAudioTimestamp != null) {
      setValueByPath(toObject, ["audioTimestamp"], fromAudioTimestamp);
    }
    const fromCandidateCount = getValueByPath(fromObject, [
      "candidateCount"
    ]);
    if (fromCandidateCount != null) {
      setValueByPath(toObject, ["candidateCount"], fromCandidateCount);
    }
    const fromEnableAffectiveDialog = getValueByPath(fromObject, [
      "enableAffectiveDialog"
    ]);
    if (fromEnableAffectiveDialog != null) {
      setValueByPath(toObject, ["enableAffectiveDialog"], fromEnableAffectiveDialog);
    }
    const fromFrequencyPenalty = getValueByPath(fromObject, [
      "frequencyPenalty"
    ]);
    if (fromFrequencyPenalty != null) {
      setValueByPath(toObject, ["frequencyPenalty"], fromFrequencyPenalty);
    }
    const fromLogprobs = getValueByPath(fromObject, ["logprobs"]);
    if (fromLogprobs != null) {
      setValueByPath(toObject, ["logprobs"], fromLogprobs);
    }
    const fromMaxOutputTokens = getValueByPath(fromObject, [
      "maxOutputTokens"
    ]);
    if (fromMaxOutputTokens != null) {
      setValueByPath(toObject, ["maxOutputTokens"], fromMaxOutputTokens);
    }
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromPresencePenalty = getValueByPath(fromObject, [
      "presencePenalty"
    ]);
    if (fromPresencePenalty != null) {
      setValueByPath(toObject, ["presencePenalty"], fromPresencePenalty);
    }
    const fromResponseLogprobs = getValueByPath(fromObject, [
      "responseLogprobs"
    ]);
    if (fromResponseLogprobs != null) {
      setValueByPath(toObject, ["responseLogprobs"], fromResponseLogprobs);
    }
    const fromResponseMimeType = getValueByPath(fromObject, [
      "responseMimeType"
    ]);
    if (fromResponseMimeType != null) {
      setValueByPath(toObject, ["responseMimeType"], fromResponseMimeType);
    }
    const fromResponseModalities = getValueByPath(fromObject, [
      "responseModalities"
    ]);
    if (fromResponseModalities != null) {
      setValueByPath(toObject, ["responseModalities"], fromResponseModalities);
    }
    const fromResponseSchema = getValueByPath(fromObject, [
      "responseSchema"
    ]);
    if (fromResponseSchema != null) {
      setValueByPath(toObject, ["responseSchema"], fromResponseSchema);
    }
    const fromRoutingConfig = getValueByPath(fromObject, [
      "routingConfig"
    ]);
    if (fromRoutingConfig != null) {
      setValueByPath(toObject, ["routingConfig"], fromRoutingConfig);
    }
    const fromSeed = getValueByPath(fromObject, ["seed"]);
    if (fromSeed != null) {
      setValueByPath(toObject, ["seed"], fromSeed);
    }
    const fromSpeechConfig = getValueByPath(fromObject, ["speechConfig"]);
    if (fromSpeechConfig != null) {
      setValueByPath(toObject, ["speechConfig"], fromSpeechConfig);
    }
    const fromStopSequences = getValueByPath(fromObject, [
      "stopSequences"
    ]);
    if (fromStopSequences != null) {
      setValueByPath(toObject, ["stopSequences"], fromStopSequences);
    }
    const fromTemperature = getValueByPath(fromObject, ["temperature"]);
    if (fromTemperature != null) {
      setValueByPath(toObject, ["temperature"], fromTemperature);
    }
    const fromThinkingConfig = getValueByPath(fromObject, [
      "thinkingConfig"
    ]);
    if (fromThinkingConfig != null) {
      setValueByPath(toObject, ["thinkingConfig"], fromThinkingConfig);
    }
    const fromTopK = getValueByPath(fromObject, ["topK"]);
    if (fromTopK != null) {
      setValueByPath(toObject, ["topK"], fromTopK);
    }
    const fromTopP = getValueByPath(fromObject, ["topP"]);
    if (fromTopP != null) {
      setValueByPath(toObject, ["topP"], fromTopP);
    }
    return toObject;
  }
  function getTuningJobParametersToMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    return toObject;
  }
  function getTuningJobParametersToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["_url", "name"], fromName);
    }
    return toObject;
  }
  function listTuningJobsConfigToVertex(fromObject, parentObject, _rootObject) {
    const toObject = {};
    const fromPageSize = getValueByPath(fromObject, ["pageSize"]);
    if (parentObject !== void 0 && fromPageSize != null) {
      setValueByPath(parentObject, ["_query", "pageSize"], fromPageSize);
    }
    const fromPageToken = getValueByPath(fromObject, ["pageToken"]);
    if (parentObject !== void 0 && fromPageToken != null) {
      setValueByPath(parentObject, ["_query", "pageToken"], fromPageToken);
    }
    const fromFilter = getValueByPath(fromObject, ["filter"]);
    if (parentObject !== void 0 && fromFilter != null) {
      setValueByPath(parentObject, ["_query", "filter"], fromFilter);
    }
    return toObject;
  }
  function listTuningJobsParametersToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromConfig = getValueByPath(fromObject, ["config"]);
    if (fromConfig != null) {
      listTuningJobsConfigToVertex(fromConfig, toObject);
    }
    return toObject;
  }
  function listTuningJobsResponseFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromNextPageToken = getValueByPath(fromObject, [
      "nextPageToken"
    ]);
    if (fromNextPageToken != null) {
      setValueByPath(toObject, ["nextPageToken"], fromNextPageToken);
    }
    const fromTuningJobs = getValueByPath(fromObject, ["tuningJobs"]);
    if (fromTuningJobs != null) {
      let transformedList = fromTuningJobs;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return tuningJobFromVertex(item);
        });
      }
      setValueByPath(toObject, ["tuningJobs"], transformedList);
    }
    return toObject;
  }
  function partToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromMediaResolution = getValueByPath(fromObject, [
      "mediaResolution"
    ]);
    if (fromMediaResolution != null) {
      setValueByPath(toObject, ["mediaResolution"], fromMediaResolution);
    }
    const fromCodeExecutionResult = getValueByPath(fromObject, [
      "codeExecutionResult"
    ]);
    if (fromCodeExecutionResult != null) {
      setValueByPath(toObject, ["codeExecutionResult"], codeExecutionResultToVertex(fromCodeExecutionResult));
    }
    const fromExecutableCode = getValueByPath(fromObject, [
      "executableCode"
    ]);
    if (fromExecutableCode != null) {
      setValueByPath(toObject, ["executableCode"], executableCodeToVertex(fromExecutableCode));
    }
    const fromFileData = getValueByPath(fromObject, ["fileData"]);
    if (fromFileData != null) {
      setValueByPath(toObject, ["fileData"], fromFileData);
    }
    const fromFunctionCall = getValueByPath(fromObject, ["functionCall"]);
    if (fromFunctionCall != null) {
      setValueByPath(toObject, ["functionCall"], fromFunctionCall);
    }
    const fromFunctionResponse = getValueByPath(fromObject, [
      "functionResponse"
    ]);
    if (fromFunctionResponse != null) {
      setValueByPath(toObject, ["functionResponse"], fromFunctionResponse);
    }
    const fromInlineData = getValueByPath(fromObject, ["inlineData"]);
    if (fromInlineData != null) {
      setValueByPath(toObject, ["inlineData"], fromInlineData);
    }
    const fromText = getValueByPath(fromObject, ["text"]);
    if (fromText != null) {
      setValueByPath(toObject, ["text"], fromText);
    }
    const fromThought = getValueByPath(fromObject, ["thought"]);
    if (fromThought != null) {
      setValueByPath(toObject, ["thought"], fromThought);
    }
    const fromThoughtSignature = getValueByPath(fromObject, [
      "thoughtSignature"
    ]);
    if (fromThoughtSignature != null) {
      setValueByPath(toObject, ["thoughtSignature"], fromThoughtSignature);
    }
    const fromVideoMetadata = getValueByPath(fromObject, [
      "videoMetadata"
    ]);
    if (fromVideoMetadata != null) {
      setValueByPath(toObject, ["videoMetadata"], fromVideoMetadata);
    }
    if (getValueByPath(fromObject, ["toolCall"]) !== void 0) {
      throw new Error("toolCall parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["toolResponse"]) !== void 0) {
      throw new Error("toolResponse parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    if (getValueByPath(fromObject, ["partMetadata"]) !== void 0) {
      throw new Error("partMetadata parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function reinforcementTuningExampleToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromContents = getValueByPath(fromObject, ["contents"]);
    if (fromContents != null) {
      let transformedList = fromContents;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return contentToVertex(item);
        });
      }
      setValueByPath(toObject, ["contents"], transformedList);
    }
    const fromReferences = getValueByPath(fromObject, ["references"]);
    if (fromReferences != null) {
      setValueByPath(toObject, ["references"], fromReferences);
    }
    const fromSystemInstruction = getValueByPath(fromObject, [
      "systemInstruction"
    ]);
    if (fromSystemInstruction != null) {
      setValueByPath(toObject, ["systemInstruction"], contentToVertex(fromSystemInstruction));
    }
    return toObject;
  }
  function tunedModelFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromModel = getValueByPath(fromObject, ["name"]);
    if (fromModel != null) {
      setValueByPath(toObject, ["model"], fromModel);
    }
    const fromEndpoint = getValueByPath(fromObject, ["name"]);
    if (fromEndpoint != null) {
      setValueByPath(toObject, ["endpoint"], fromEndpoint);
    }
    return toObject;
  }
  function tuningDatasetToMldev(fromObject, _rootObject) {
    const toObject = {};
    if (getValueByPath(fromObject, ["gcsUri"]) !== void 0) {
      throw new Error("gcsUri parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    if (getValueByPath(fromObject, ["vertexDatasetResource"]) !== void 0) {
      throw new Error("vertexDatasetResource parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.");
    }
    const fromExamples = getValueByPath(fromObject, ["examples"]);
    if (fromExamples != null) {
      let transformedList = fromExamples;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["examples", "examples"], transformedList);
    }
    return toObject;
  }
  function tuningDatasetToVertex(fromObject, parentObject, rootObject) {
    const toObject = {};
    let discriminatorGcsUri = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorGcsUri === void 0) {
      discriminatorGcsUri = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorGcsUri === "SUPERVISED_FINE_TUNING") {
      const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
      if (parentObject !== void 0 && fromGcsUri != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "trainingDatasetUri"], fromGcsUri);
      }
    } else if (discriminatorGcsUri === "PREFERENCE_TUNING") {
      const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
      if (parentObject !== void 0 && fromGcsUri != null) {
        setValueByPath(parentObject, ["preferenceOptimizationSpec", "trainingDatasetUri"], fromGcsUri);
      }
    } else if (discriminatorGcsUri === "DISTILLATION") {
      const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
      if (parentObject !== void 0 && fromGcsUri != null) {
        setValueByPath(parentObject, ["distillationSpec", "promptDatasetUri"], fromGcsUri);
      }
    } else if (discriminatorGcsUri === "REINFORCEMENT_TUNING") {
      const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
      if (parentObject !== void 0 && fromGcsUri != null) {
        setValueByPath(parentObject, ["reinforcementTuningSpec", "trainingDatasetUri"], fromGcsUri);
      }
    }
    let discriminatorVertexDatasetResource = getValueByPath(rootObject, [
      "config",
      "method"
    ]);
    if (discriminatorVertexDatasetResource === void 0) {
      discriminatorVertexDatasetResource = "SUPERVISED_FINE_TUNING";
    }
    if (discriminatorVertexDatasetResource === "SUPERVISED_FINE_TUNING") {
      const fromVertexDatasetResource = getValueByPath(fromObject, [
        "vertexDatasetResource"
      ]);
      if (parentObject !== void 0 && fromVertexDatasetResource != null) {
        setValueByPath(parentObject, ["supervisedTuningSpec", "trainingDatasetUri"], fromVertexDatasetResource);
      }
    } else if (discriminatorVertexDatasetResource === "PREFERENCE_TUNING") {
      const fromVertexDatasetResource = getValueByPath(fromObject, [
        "vertexDatasetResource"
      ]);
      if (parentObject !== void 0 && fromVertexDatasetResource != null) {
        setValueByPath(parentObject, ["preferenceOptimizationSpec", "trainingDatasetUri"], fromVertexDatasetResource);
      }
    } else if (discriminatorVertexDatasetResource === "DISTILLATION") {
      const fromVertexDatasetResource = getValueByPath(fromObject, [
        "vertexDatasetResource"
      ]);
      if (parentObject !== void 0 && fromVertexDatasetResource != null) {
        setValueByPath(parentObject, ["distillationSpec", "promptDatasetUri"], fromVertexDatasetResource);
      }
    } else if (discriminatorVertexDatasetResource === "REINFORCEMENT_TUNING") {
      const fromVertexDatasetResource = getValueByPath(fromObject, [
        "vertexDatasetResource"
      ]);
      if (parentObject !== void 0 && fromVertexDatasetResource != null) {
        setValueByPath(parentObject, ["reinforcementTuningSpec", "trainingDatasetUri"], fromVertexDatasetResource);
      }
    }
    if (getValueByPath(fromObject, ["examples"]) !== void 0) {
      throw new Error("examples parameter is only supported in Gemini Developer API mode, not in Gemini Enterprise Agent Platform mode.");
    }
    return toObject;
  }
  function tuningJobFromMldev(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromState = getValueByPath(fromObject, ["state"]);
    if (fromState != null) {
      setValueByPath(toObject, ["state"], tTuningJobStatus(fromState));
    }
    const fromCreateTime = getValueByPath(fromObject, ["createTime"]);
    if (fromCreateTime != null) {
      setValueByPath(toObject, ["createTime"], fromCreateTime);
    }
    const fromStartTime = getValueByPath(fromObject, [
      "tuningTask",
      "startTime"
    ]);
    if (fromStartTime != null) {
      setValueByPath(toObject, ["startTime"], fromStartTime);
    }
    const fromEndTime = getValueByPath(fromObject, [
      "tuningTask",
      "completeTime"
    ]);
    if (fromEndTime != null) {
      setValueByPath(toObject, ["endTime"], fromEndTime);
    }
    const fromUpdateTime = getValueByPath(fromObject, ["updateTime"]);
    if (fromUpdateTime != null) {
      setValueByPath(toObject, ["updateTime"], fromUpdateTime);
    }
    const fromDescription = getValueByPath(fromObject, ["description"]);
    if (fromDescription != null) {
      setValueByPath(toObject, ["description"], fromDescription);
    }
    const fromBaseModel = getValueByPath(fromObject, ["baseModel"]);
    if (fromBaseModel != null) {
      setValueByPath(toObject, ["baseModel"], fromBaseModel);
    }
    const fromTunedModel = getValueByPath(fromObject, ["_self"]);
    if (fromTunedModel != null) {
      setValueByPath(toObject, ["tunedModel"], tunedModelFromMldev(fromTunedModel));
    }
    return toObject;
  }
  function tuningJobFromVertex(fromObject, rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromState = getValueByPath(fromObject, ["state"]);
    if (fromState != null) {
      setValueByPath(toObject, ["state"], tTuningJobStatus(fromState));
    }
    const fromCreateTime = getValueByPath(fromObject, ["createTime"]);
    if (fromCreateTime != null) {
      setValueByPath(toObject, ["createTime"], fromCreateTime);
    }
    const fromStartTime = getValueByPath(fromObject, ["startTime"]);
    if (fromStartTime != null) {
      setValueByPath(toObject, ["startTime"], fromStartTime);
    }
    const fromEndTime = getValueByPath(fromObject, ["endTime"]);
    if (fromEndTime != null) {
      setValueByPath(toObject, ["endTime"], fromEndTime);
    }
    const fromUpdateTime = getValueByPath(fromObject, ["updateTime"]);
    if (fromUpdateTime != null) {
      setValueByPath(toObject, ["updateTime"], fromUpdateTime);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromDescription = getValueByPath(fromObject, ["description"]);
    if (fromDescription != null) {
      setValueByPath(toObject, ["description"], fromDescription);
    }
    const fromBaseModel = getValueByPath(fromObject, ["baseModel"]);
    if (fromBaseModel != null) {
      setValueByPath(toObject, ["baseModel"], fromBaseModel);
    }
    const fromTunedModel = getValueByPath(fromObject, ["tunedModel"]);
    if (fromTunedModel != null) {
      setValueByPath(toObject, ["tunedModel"], fromTunedModel);
    }
    const fromPreTunedModel = getValueByPath(fromObject, [
      "preTunedModel"
    ]);
    if (fromPreTunedModel != null) {
      setValueByPath(toObject, ["preTunedModel"], fromPreTunedModel);
    }
    const fromSupervisedTuningSpec = getValueByPath(fromObject, [
      "supervisedTuningSpec"
    ]);
    if (fromSupervisedTuningSpec != null) {
      setValueByPath(toObject, ["supervisedTuningSpec"], fromSupervisedTuningSpec);
    }
    const fromPreferenceOptimizationSpec = getValueByPath(fromObject, [
      "preferenceOptimizationSpec"
    ]);
    if (fromPreferenceOptimizationSpec != null) {
      setValueByPath(toObject, ["preferenceOptimizationSpec"], fromPreferenceOptimizationSpec);
    }
    const fromDistillationSpec = getValueByPath(fromObject, [
      "distillationSpec"
    ]);
    if (fromDistillationSpec != null) {
      setValueByPath(toObject, ["distillationSpec"], distillationSpecFromVertex(fromDistillationSpec));
    }
    const fromReinforcementTuningSpec = getValueByPath(fromObject, [
      "reinforcementTuningSpec"
    ]);
    if (fromReinforcementTuningSpec != null) {
      setValueByPath(toObject, ["reinforcementTuningSpec"], fromReinforcementTuningSpec);
    }
    const fromTuningDataStats = getValueByPath(fromObject, [
      "tuningDataStats"
    ]);
    if (fromTuningDataStats != null) {
      setValueByPath(toObject, ["tuningDataStats"], fromTuningDataStats);
    }
    const fromEncryptionSpec = getValueByPath(fromObject, [
      "encryptionSpec"
    ]);
    if (fromEncryptionSpec != null) {
      setValueByPath(toObject, ["encryptionSpec"], fromEncryptionSpec);
    }
    const fromPartnerModelTuningSpec = getValueByPath(fromObject, [
      "partnerModelTuningSpec"
    ]);
    if (fromPartnerModelTuningSpec != null) {
      setValueByPath(toObject, ["partnerModelTuningSpec"], fromPartnerModelTuningSpec);
    }
    const fromCustomBaseModel = getValueByPath(fromObject, [
      "customBaseModel"
    ]);
    if (fromCustomBaseModel != null) {
      setValueByPath(toObject, ["customBaseModel"], fromCustomBaseModel);
    }
    const fromEvaluateDatasetRuns = getValueByPath(fromObject, [
      "evaluateDatasetRuns"
    ]);
    if (fromEvaluateDatasetRuns != null) {
      let transformedList = fromEvaluateDatasetRuns;
      if (Array.isArray(transformedList)) {
        transformedList = transformedList.map((item) => {
          return item;
        });
      }
      setValueByPath(toObject, ["evaluateDatasetRuns"], transformedList);
    }
    const fromExperiment = getValueByPath(fromObject, ["experiment"]);
    if (fromExperiment != null) {
      setValueByPath(toObject, ["experiment"], fromExperiment);
    }
    const fromFullFineTuningSpec = getValueByPath(fromObject, [
      "fullFineTuningSpec"
    ]);
    if (fromFullFineTuningSpec != null) {
      setValueByPath(toObject, ["fullFineTuningSpec"], fromFullFineTuningSpec);
    }
    const fromLabels = getValueByPath(fromObject, ["labels"]);
    if (fromLabels != null) {
      setValueByPath(toObject, ["labels"], fromLabels);
    }
    const fromOutputUri = getValueByPath(fromObject, ["outputUri"]);
    if (fromOutputUri != null) {
      setValueByPath(toObject, ["outputUri"], fromOutputUri);
    }
    const fromPipelineJob = getValueByPath(fromObject, ["pipelineJob"]);
    if (fromPipelineJob != null) {
      setValueByPath(toObject, ["pipelineJob"], fromPipelineJob);
    }
    const fromServiceAccount = getValueByPath(fromObject, [
      "serviceAccount"
    ]);
    if (fromServiceAccount != null) {
      setValueByPath(toObject, ["serviceAccount"], fromServiceAccount);
    }
    const fromTunedModelDisplayName = getValueByPath(fromObject, [
      "tunedModelDisplayName"
    ]);
    if (fromTunedModelDisplayName != null) {
      setValueByPath(toObject, ["tunedModelDisplayName"], fromTunedModelDisplayName);
    }
    const fromTuningJobState = getValueByPath(fromObject, [
      "tuningJobState"
    ]);
    if (fromTuningJobState != null) {
      setValueByPath(toObject, ["tuningJobState"], fromTuningJobState);
    }
    const fromVeoTuningSpec = getValueByPath(fromObject, [
      "veoTuningSpec"
    ]);
    if (fromVeoTuningSpec != null) {
      setValueByPath(toObject, ["veoTuningSpec"], fromVeoTuningSpec);
    }
    const fromTuningJobMetadata = getValueByPath(fromObject, [
      "tuningJobMetadata"
    ]);
    if (fromTuningJobMetadata != null) {
      setValueByPath(toObject, ["tuningJobMetadata"], fromTuningJobMetadata);
    }
    const fromVeoLoraTuningSpec = getValueByPath(fromObject, [
      "veoLoraTuningSpec"
    ]);
    if (fromVeoLoraTuningSpec != null) {
      setValueByPath(toObject, ["veoLoraTuningSpec"], fromVeoLoraTuningSpec);
    }
    const fromDistillationSamplingSpec = getValueByPath(fromObject, [
      "distillationSamplingSpec"
    ]);
    if (fromDistillationSamplingSpec != null) {
      setValueByPath(toObject, ["distillationSamplingSpec"], distillationSamplingSpecFromVertex(fromDistillationSamplingSpec));
    }
    return toObject;
  }
  function tuningOperationFromMldev(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromName = getValueByPath(fromObject, ["name"]);
    if (fromName != null) {
      setValueByPath(toObject, ["name"], fromName);
    }
    const fromMetadata = getValueByPath(fromObject, ["metadata"]);
    if (fromMetadata != null) {
      setValueByPath(toObject, ["metadata"], fromMetadata);
    }
    const fromDone = getValueByPath(fromObject, ["done"]);
    if (fromDone != null) {
      setValueByPath(toObject, ["done"], fromDone);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    return toObject;
  }
  function tuningValidationDatasetToVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromGcsUri = getValueByPath(fromObject, ["gcsUri"]);
    if (fromGcsUri != null) {
      setValueByPath(toObject, ["validationDatasetUri"], fromGcsUri);
    }
    const fromVertexDatasetResource = getValueByPath(fromObject, [
      "vertexDatasetResource"
    ]);
    if (fromVertexDatasetResource != null) {
      setValueByPath(toObject, ["validationDatasetUri"], fromVertexDatasetResource);
    }
    return toObject;
  }
  function validateRewardParametersToVertex(fromObject, rootObject) {
    const toObject = {};
    const fromParent = getValueByPath(fromObject, ["parent"]);
    if (fromParent != null) {
      setValueByPath(toObject, ["_url", "parent"], fromParent);
    }
    const fromSampleResponse = getValueByPath(fromObject, [
      "sampleResponse"
    ]);
    if (fromSampleResponse != null) {
      setValueByPath(toObject, ["sampleResponse"], contentToVertex(fromSampleResponse));
    }
    const fromExample = getValueByPath(fromObject, ["example"]);
    if (fromExample != null) {
      setValueByPath(toObject, ["example"], reinforcementTuningExampleToVertex(fromExample));
    }
    const fromSingleRewardConfig = getValueByPath(fromObject, [
      "singleRewardConfig"
    ]);
    if (fromSingleRewardConfig != null) {
      setValueByPath(toObject, ["singleRewardConfig"], fromSingleRewardConfig);
    }
    const fromCompositeRewardConfig = getValueByPath(fromObject, [
      "compositeRewardConfig"
    ]);
    if (fromCompositeRewardConfig != null) {
      setValueByPath(toObject, ["compositeRewardConfig"], fromCompositeRewardConfig);
    }
    return toObject;
  }
  function validateRewardResponseFromVertex(fromObject, _rootObject) {
    const toObject = {};
    const fromSdkHttpResponse = getValueByPath(fromObject, [
      "sdkHttpResponse"
    ]);
    if (fromSdkHttpResponse != null) {
      setValueByPath(toObject, ["sdkHttpResponse"], fromSdkHttpResponse);
    }
    const fromOverallReward = getValueByPath(fromObject, [
      "overallReward"
    ]);
    if (fromOverallReward != null) {
      setValueByPath(toObject, ["overallReward"], fromOverallReward);
    }
    const fromError = getValueByPath(fromObject, ["error"]);
    if (fromError != null) {
      setValueByPath(toObject, ["error"], fromError);
    }
    const fromRewardInfoDetails = getValueByPath(fromObject, [
      "rewardInfoDetails"
    ]);
    if (fromRewardInfoDetails != null) {
      setValueByPath(toObject, ["rewardInfoDetails"], fromRewardInfoDetails);
    }
    return toObject;
  }
  var Tunings = class extends BaseModule {
    constructor(apiClient) {
      super();
      this.apiClient = apiClient;
      this.list = async (params = {}) => {
        return new Pager(PagedItem.PAGED_ITEM_TUNING_JOBS, (x) => this.listInternal(x), await this.listInternal(params), params);
      };
      this.get = async (params) => {
        return await this.getInternal(params);
      };
      this.tune = async (params) => {
        var _a2;
        if (this.apiClient.isVertexAI()) {
          if (params.baseModel.startsWith("projects/")) {
            const preTunedModel = {
              tunedModelName: params.baseModel
            };
            if ((_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.preTunedModelCheckpointId) {
              preTunedModel.checkpointId = params.config.preTunedModelCheckpointId;
            }
            const paramsPrivate = Object.assign(Object.assign({}, params), { preTunedModel });
            paramsPrivate.baseModel = void 0;
            return await this.tuneInternal(paramsPrivate);
          } else {
            const paramsPrivate = Object.assign({}, params);
            return await this.tuneInternal(paramsPrivate);
          }
        } else {
          const paramsPrivate = Object.assign({}, params);
          const operation = await this.tuneMldevInternal(paramsPrivate);
          let tunedModelName = "";
          if (operation["metadata"] !== void 0 && operation["metadata"]["tunedModel"] !== void 0) {
            tunedModelName = operation["metadata"]["tunedModel"];
          } else if (operation["name"] !== void 0 && operation["name"].includes("/operations/")) {
            tunedModelName = operation["name"].split("/operations/")[0];
          }
          const tuningJob = {
            name: tunedModelName,
            state: JobState.JOB_STATE_QUEUED
          };
          return tuningJob;
        }
      };
    }
    async getInternal(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = getTuningJobParametersToVertex(params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = tuningJobFromVertex(apiResponse);
          return resp;
        });
      } else {
        const body = getTuningJobParametersToMldev(params);
        path = formatMap("{name}", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = tuningJobFromMldev(apiResponse);
          return resp;
        });
      }
    }
    async listInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = listTuningJobsParametersToVertex(params);
        path = formatMap("tuningJobs", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "GET",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = listTuningJobsResponseFromVertex(apiResponse);
          const typedResp = new ListTuningJobsResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
    /**
     * Cancels a tuning job.
     *
     * @param params - The parameters for the cancel request.
     * @return The empty response returned by the API.
     *
     * @example
     * ```ts
     * await ai.tunings.cancel({name: '...'}); // The server-generated resource name.
     * ```
     */
    async cancel(params) {
      var _a2, _b, _c, _d;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = cancelTuningJobParametersToVertex(params);
        path = formatMap("{name}:cancel", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = cancelTuningJobResponseFromVertex(apiResponse);
          const typedResp = new CancelTuningJobResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        const body = cancelTuningJobParametersToMldev(params);
        path = formatMap("{name}:cancel", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_c = params.config) === null || _c === void 0 ? void 0 : _c.httpOptions,
          abortSignal: (_d = params.config) === null || _d === void 0 ? void 0 : _d.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = cancelTuningJobResponseFromMldev(apiResponse);
          const typedResp = new CancelTuningJobResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      }
    }
    async tuneInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = createTuningJobParametersPrivateToVertex(params, params);
        path = formatMap("tuningJobs", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = tuningJobFromVertex(apiResponse);
          return resp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
    async tuneMldevInternal(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        throw new Error("This method is only supported by the Gemini Developer API.");
      } else {
        const body = createTuningJobParametersPrivateToMldev(params);
        path = formatMap("tunedModels", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = tuningOperationFromMldev(apiResponse);
          return resp;
        });
      }
    }
    async validateReward(params) {
      var _a2, _b;
      let response;
      let path = "";
      let queryParams = {};
      if (this.apiClient.isVertexAI()) {
        const body = validateRewardParametersToVertex(params);
        path = formatMap("{parent}/tuningJobs:validateReinforcementTuningReward", body["_url"]);
        queryParams = body["_query"];
        delete body["_url"];
        delete body["_query"];
        response = this.apiClient.request({
          path,
          queryParams,
          body: JSON.stringify(body),
          httpMethod: "POST",
          httpOptions: (_a2 = params.config) === null || _a2 === void 0 ? void 0 : _a2.httpOptions,
          abortSignal: (_b = params.config) === null || _b === void 0 ? void 0 : _b.abortSignal
        }).then((httpResponse) => {
          return httpResponse.json().then((jsonResponse) => {
            const response2 = jsonResponse;
            response2.sdkHttpResponse = {
              headers: httpResponse.headers
            };
            return response2;
          });
        });
        return response.then((apiResponse) => {
          const resp = validateRewardResponseFromVertex(apiResponse);
          const typedResp = new ValidateRewardResponse();
          Object.assign(typedResp, resp);
          return typedResp;
        });
      } else {
        throw new Error("This method is only supported by the Gemini Enterprise Agent Platform (previously known as Vertex AI).");
      }
    }
  };
  var BrowserDownloader = class {
    async download(_params, _apiClient) {
      throw new Error("Download to file is not supported in the browser, please use a browser compliant download like an <a> tag.");
    }
  };
  var MAX_CHUNK_SIZE = 1024 * 1024 * 8;
  var MAX_RETRY_COUNT = 3;
  var INITIAL_RETRY_DELAY_MS = 1e3;
  var DELAY_MULTIPLIER = 2;
  var X_GOOG_UPLOAD_STATUS_HEADER_FIELD = "x-goog-upload-status";
  async function uploadBlob(file, uploadUrl, apiClient, httpOptions) {
    var _a2;
    const response = await uploadBlobInternal(file, uploadUrl, apiClient, httpOptions);
    const responseJson = await (response === null || response === void 0 ? void 0 : response.json());
    if (((_a2 = response === null || response === void 0 ? void 0 : response.headers) === null || _a2 === void 0 ? void 0 : _a2[X_GOOG_UPLOAD_STATUS_HEADER_FIELD]) !== "final") {
      throw new Error("Failed to upload file: Upload status is not finalized.");
    }
    return responseJson["file"];
  }
  async function uploadBlobToFileSearchStore(file, uploadUrl, apiClient, httpOptions) {
    var _a2;
    const response = await uploadBlobInternal(file, uploadUrl, apiClient, httpOptions);
    const responseJson = await (response === null || response === void 0 ? void 0 : response.json());
    if (((_a2 = response === null || response === void 0 ? void 0 : response.headers) === null || _a2 === void 0 ? void 0 : _a2[X_GOOG_UPLOAD_STATUS_HEADER_FIELD]) !== "final") {
      throw new Error("Failed to upload file: Upload status is not finalized.");
    }
    const resp = uploadToFileSearchStoreOperationFromMldev(responseJson);
    const typedResp = new UploadToFileSearchStoreOperation();
    Object.assign(typedResp, resp);
    return typedResp;
  }
  async function uploadBlobInternal(file, uploadUrl, apiClient, httpOptions) {
    var _a2, _b, _c;
    let finalUrl = uploadUrl;
    const effectiveBaseUrl = (httpOptions === null || httpOptions === void 0 ? void 0 : httpOptions.baseUrl) || ((_a2 = apiClient.clientOptions.httpOptions) === null || _a2 === void 0 ? void 0 : _a2.baseUrl);
    if (effectiveBaseUrl) {
      const baseUri = new URL(effectiveBaseUrl);
      const uploadUri = new URL(uploadUrl);
      uploadUri.protocol = baseUri.protocol;
      uploadUri.host = baseUri.host;
      uploadUri.port = baseUri.port;
      finalUrl = uploadUri.toString();
    }
    let fileSize = 0;
    let offset = 0;
    let response = new HttpResponse(new Response());
    let uploadCommand = "upload";
    fileSize = file.size;
    while (offset < fileSize) {
      const chunkSize = Math.min(MAX_CHUNK_SIZE, fileSize - offset);
      const chunk = file.slice(offset, offset + chunkSize);
      if (offset + chunkSize >= fileSize) {
        uploadCommand += ", finalize";
      }
      let retryCount = 0;
      let currentDelayMs = INITIAL_RETRY_DELAY_MS;
      while (retryCount < MAX_RETRY_COUNT) {
        const mergedHeaders = Object.assign(Object.assign({}, (httpOptions === null || httpOptions === void 0 ? void 0 : httpOptions.headers) || {}), { "X-Goog-Upload-Command": uploadCommand, "X-Goog-Upload-Offset": String(offset), "Content-Length": String(chunkSize) });
        response = await apiClient.request({
          path: "",
          body: chunk,
          httpMethod: "POST",
          httpOptions: Object.assign(Object.assign({}, httpOptions), { apiVersion: "", baseUrl: finalUrl, headers: mergedHeaders })
        });
        if ((_b = response === null || response === void 0 ? void 0 : response.headers) === null || _b === void 0 ? void 0 : _b[X_GOOG_UPLOAD_STATUS_HEADER_FIELD]) {
          break;
        }
        retryCount++;
        await sleep(currentDelayMs);
        currentDelayMs = currentDelayMs * DELAY_MULTIPLIER;
      }
      offset += chunkSize;
      if (((_c = response === null || response === void 0 ? void 0 : response.headers) === null || _c === void 0 ? void 0 : _c[X_GOOG_UPLOAD_STATUS_HEADER_FIELD]) !== "active") {
        break;
      }
      if (fileSize <= offset) {
        throw new Error("All content has been uploaded, but the upload status is not finalized.");
      }
    }
    return response;
  }
  async function getBlobStat(file) {
    const fileStat = { size: file.size, type: file.type };
    return fileStat;
  }
  function sleep(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
  }
  var BrowserUploader = class {
    async upload(file, uploadUrl, apiClient, httpOptions) {
      if (typeof file === "string") {
        throw new Error("File path is not supported in browser uploader.");
      }
      return await uploadBlob(file, uploadUrl, apiClient, httpOptions);
    }
    async uploadToFileSearchStore(file, uploadUrl, apiClient, httpOptions) {
      if (typeof file === "string") {
        throw new Error("File path is not supported in browser uploader.");
      }
      return await uploadBlobToFileSearchStore(file, uploadUrl, apiClient, httpOptions);
    }
    async stat(file) {
      if (typeof file === "string") {
        throw new Error("File path is not supported in browser uploader.");
      } else {
        return await getBlobStat(file);
      }
    }
  };
  var BrowserWebSocketFactory = class {
    create(url, headers, callbacks) {
      return new BrowserWebSocket(url, headers, callbacks);
    }
  };
  var BrowserWebSocket = class {
    constructor(url, headers, callbacks) {
      this.url = url;
      this.headers = headers;
      this.callbacks = callbacks;
    }
    connect() {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = this.callbacks.onopen;
      this.ws.onerror = this.callbacks.onerror;
      this.ws.onclose = this.callbacks.onclose;
      this.ws.onmessage = this.callbacks.onmessage;
    }
    send(message) {
      if (this.ws === void 0) {
        throw new Error("WebSocket is not connected");
      }
      this.ws.send(message);
    }
    close() {
      if (this.ws === void 0) {
        throw new Error("WebSocket is not connected");
      }
      this.ws.close();
    }
  };
  var GOOGLE_API_KEY_HEADER = "x-goog-api-key";
  var WebAuth = class {
    constructor(apiKey) {
      this.apiKey = apiKey;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async addAuthHeaders(headers, url) {
      if (headers.get(GOOGLE_API_KEY_HEADER) !== null) {
        return;
      }
      if (this.apiKey.startsWith("auth_tokens/")) {
        throw new Error("Ephemeral tokens are only supported by the live API.");
      }
      if (!this.apiKey) {
        throw new Error("API key is missing. Please provide a valid API key.");
      }
      headers.append(GOOGLE_API_KEY_HEADER, this.apiKey);
    }
  };
  var LANGUAGE_LABEL_PREFIX = "gl-node/";
  var GoogleGenAI2 = class {
    getNextGenClient() {
      const httpOpts = this.httpOptions;
      if (this._nextGenClient === void 0) {
        this._nextGenClient = buildGoogleGenAIClient(this.apiClient, {
          timeout_ms: httpOpts === null || httpOpts === void 0 ? void 0 : httpOpts.timeout
        });
      }
      if (httpOpts === null || httpOpts === void 0 ? void 0 : httpOpts.extraBody) {
        console.warn("GoogleGenAI: Client level httpOptions.extraBody is not supported by the Gemini NextGen client and will be ignored.");
      }
      return this._nextGenClient;
    }
    get interactions() {
      if (this._interactions !== void 0) {
        return this._interactions;
      }
      this._interactions = new GeminiNextGenInteractions(this.apiClient);
      return this._interactions;
    }
    get webhooks() {
      if (this._webhooks !== void 0) {
        return this._webhooks;
      }
      this._webhooks = new GeminiNextGenWebhooks(this.apiClient);
      return this._webhooks;
    }
    get agents() {
      if (this._agents !== void 0) {
        return this._agents;
      }
      console.warn("GoogleGenAI.agents: Agents usage is experimental and may change in future versions.");
      this._agents = new GeminiNextGenAgents(this.apiClient);
      return this._agents;
    }
    constructor(options) {
      var _a2;
      if (options.apiKey == null) {
        throw new Error("An API Key must be set when running in a browser");
      }
      if (options.project || options.location) {
        throw new Error("Vertex AI project based authentication is not supported on browser runtimes. Please do not provide a project or location.");
      }
      this.vertexai = (_a2 = options.vertexai) !== null && _a2 !== void 0 ? _a2 : false;
      this.apiKey = options.apiKey;
      const baseUrl = getBaseUrl(
        options.httpOptions,
        options.vertexai,
        /*vertexBaseUrlFromEnv*/
        void 0,
        /*geminiBaseUrlFromEnv*/
        void 0
      );
      if (baseUrl) {
        if (options.httpOptions) {
          options.httpOptions.baseUrl = baseUrl;
        } else {
          options.httpOptions = { baseUrl };
        }
      }
      this.apiVersion = options.apiVersion;
      this.httpOptions = options.httpOptions;
      const auth = new WebAuth(this.apiKey);
      this.apiClient = new ApiClient({
        auth,
        apiVersion: this.apiVersion,
        apiKey: this.apiKey,
        vertexai: this.vertexai,
        httpOptions: this.httpOptions,
        userAgentExtra: LANGUAGE_LABEL_PREFIX + "web",
        uploader: new BrowserUploader(),
        downloader: new BrowserDownloader()
      });
      this.models = new Models(this.apiClient);
      this.live = new Live(this.apiClient, auth, new BrowserWebSocketFactory());
      this.batches = new Batches(this.apiClient);
      this.chats = new Chats(this.models, this.apiClient);
      this.caches = new Caches(this.apiClient);
      this.files = new Files(this.apiClient);
      this.operations = new Operations(this.apiClient);
      this.authTokens = new Tokens(this.apiClient);
      this.tunings = new Tunings(this.apiClient);
      this.fileSearchStores = new FileSearchStores(this.apiClient);
    }
  };

  // extension/lib/langs.js
  var LANG_LABELS = { vi: "ti\u1EBFng Vi\u1EC7t", en: "English", ja: "\u65E5\u672C\u8A9E", ko: "\uD55C\uAD6D\uC5B4", "zh-CN": "\u4E2D\u6587", zh: "\u4E2D\u6587" };
  var LANG_BCP47 = { vi: "vi", en: "en", ja: "ja", ko: "ko", "zh-CN": "zh-Hans", zh: "zh-Hans" };
  var bcp47 = (code) => LANG_BCP47[code] || code || "en";

  // extension/lib/gemini-live.js
  var MODEL = "gemini-3.5-live-translate-preview";
  var RECONNECT_MS = 1500;
  var PARTIAL_DEBOUNCE_MS = 120;
  var TR_SENT_END = /[.!?。．！？]\s*$/;
  var LONG_IDLE_MS = 2500;
  var INPUT_GRACE_MS = 700;
  var SETTLE_PAUSE_MS = 700;
  var AUDIO_MAX_SAMPLES = 24e3 * 3 | 0;
  var AUDIO_IDLE_MS = 250;
  var AUDIO_BREAK_GRACE_MS = 160;
  var TR_BREAK = /[.!?。．！？]/;
  function _b64ToBytes(b64) {
    const bin = atob(b64);
    const n = bin.length;
    const u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function _bytesToB64(bytes) {
    let s = "";
    const CH = 32768;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function _f32ToPcm16B64(f32) {
    const buf = new ArrayBuffer(f32.length * 2);
    const dv = new DataView(buf);
    for (let i = 0; i < f32.length; i++) {
      let s = f32[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      dv.setInt16(i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
    }
    return _bytesToB64(new Uint8Array(buf));
  }
  function _ts() {
    const d = /* @__PURE__ */ new Date(), p = (n) => (n < 10 ? "0" : "") + n;
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function createLiveTranslator(opts) {
    const st2 = () => opts.getState();
    const onCaption = opts.onCaption || (() => {
    });
    const onAudio = opts.onAudio || (() => {
    });
    const onClear = opts.onClear || (() => {
    });
    const onStatus = opts.onStatus || (() => {
    });
    let _started = false, _session = null, _connecting = null, _gen = 0;
    let _handle = null;
    let _reconnectTimer = null, _emitTimer = null, _flushTimer = null;
    let _lineBase = 1, _inAcc = "", _outAcc = "", _turnEnded = false;
    let _audioBuf = [], _audioSamples = 0, _audioIdleTimer = null, _audioBreakTimer = null;
    const isConfigured = () => !!(st2().apiKey && String(st2().apiKey).trim());
    function _splitVI(s) {
      s = s || "";
      const out = [];
      let start3 = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "." && /\d/.test(s[i - 1] || "") && /\d/.test(s[i + 1] || "")) continue;
        if (c === "." || c === "!" || c === "?" || c === "\u3002" || c === "\uFF01" || c === "\uFF1F" || c === "\uFF0E") {
          const seg = s.slice(start3, i + 1).trim();
          if (seg) out.push(seg);
          start3 = i + 1;
        }
      }
      const tail = s.slice(start3).trim();
      if (tail) out.push(tail);
      return out;
    }
    function _mergeTrans(prev, next) {
      if (!next) return prev;
      if (!prev || next.startsWith(prev)) return next;
      return prev + next;
    }
    function _norm(s) {
      return (s || "").replace(/[\s。、，．！？!?.,]+/g, "").toLowerCase();
    }
    function _fmt(s) {
      const a = _splitVI(s);
      return a.length ? a.join("\n") : (s || "").trim();
    }
    function _emit(turnDone) {
      const transcribe = !!st2().transcribeMode;
      const jaSents = _splitVI(_inAcc);
      const viSents = transcribe ? [] : _splitVI(_outAcc);
      let lines = [];
      if (transcribe) {
        lines = jaSents.map((s) => ({ o: "", t: (s || "").trim() })).filter((l) => l.t);
      } else if (jaSents.length > 0 && jaSents.length === viSents.length) {
        for (let i = 0; i < jaSents.length; i++) {
          let o = (jaSents[i] || "").trim();
          const t2 = (viSents[i] || "").trim();
          if (o && t2 && _norm(o) === _norm(t2)) o = "";
          if (o || t2) lines.push({ o, t: t2 });
        }
      } else {
        let o = jaSents.join("\n").trim();
        const t2 = viSents.join("\n").trim();
        if (o && t2 && _norm(o) === _norm(t2)) o = "";
        if (o || t2) lines = [{ o, t: t2 }];
      }
      if (!lines.length) return 0;
      const original = lines.map((l) => l.o).filter(Boolean).join("\n");
      const translated = lines.map((l) => l.t).filter(Boolean).join("\n");
      onCaption({ id: _lineBase, author: "STT", lines, original, translated, isPartial: !turnDone, ts: _ts(), tsMs: Date.now() });
      return 1;
    }
    function _flush() {
      clearTimeout(_emitTimer);
      clearTimeout(_flushTimer);
      if ((_inAcc || "").trim() || (_outAcc || "").trim()) {
        if (_emit(true)) _lineBase += 1;
      }
      _inAcc = "";
      _outAcc = "";
      _turnEnded = false;
    }
    function _flushAudio(reason) {
      clearTimeout(_audioIdleTimer);
      _audioIdleTimer = null;
      clearTimeout(_audioBreakTimer);
      _audioBreakTimer = null;
      if (!_audioBuf.length) return;
      let total = 0;
      for (const b of _audioBuf) total += b.length;
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of _audioBuf) {
        merged.set(b, off);
        off += b.length;
      }
      console.log(`[tts] ph\xE1t (${reason || "?"}) ${((total >> 1) / 24e3).toFixed(2)}s | text: "\u2026${(_outAcc || "").slice(-45)}"`);
      _audioBuf = [];
      _audioSamples = 0;
      onAudio({ b64: _bytesToB64(merged), sampleRate: 24e3 });
    }
    function _bufAudio(b64) {
      const bytes = _b64ToBytes(b64);
      _audioBuf.push(bytes);
      _audioSamples += bytes.length >> 1;
      if (_audioSamples >= AUDIO_MAX_SAMPLES) {
        _flushAudio("max");
        return;
      }
      clearTimeout(_audioIdleTimer);
      _audioIdleTimer = setTimeout(() => _flushAudio("idle"), AUDIO_IDLE_MS);
    }
    function _audioBreakOnText() {
      const s = (_outAcc || "").replace(/\s+$/, "");
      if (!s) return;
      const c = s[s.length - 1];
      if (!TR_BREAK.test(c)) return;
      if ((c === "." || c === ",") && /\d/.test(s[s.length - 2] || "")) return;
      if (!_audioBuf.length) return;
      clearTimeout(_audioBreakTimer);
      _audioBreakTimer = setTimeout(() => _flushAudio("break"), AUDIO_BREAK_GRACE_MS);
    }
    function _resetAudio() {
      clearTimeout(_audioIdleTimer);
      _audioIdleTimer = null;
      clearTimeout(_audioBreakTimer);
      _audioBreakTimer = null;
      _audioBuf = [];
      _audioSamples = 0;
    }
    function _onMessage(gen, m) {
      if (gen !== _gen) return;
      try {
        if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.resumable && m.sessionResumptionUpdate.newHandle) _handle = m.sessionResumptionUpdate.newHandle;
        if (m.goAway) {
          console.log("[live] goAway \u2192 reconnect");
          _reconnectWithHandle();
          return;
        }
        const sc = m.serverContent;
        if (!sc) return;
        const transcribe = !!st2().transcribeMode;
        let changed = false;
        const itText = sc.inputTranscription && sc.inputTranscription.text;
        const otText = sc.outputTranscription && sc.outputTranscription.text;
        if (typeof itText === "string" && itText) {
          const mg = _mergeTrans(_inAcc, itText);
          if (mg !== _inAcc) {
            _inAcc = mg;
            changed = true;
          }
        }
        if (!transcribe && typeof otText === "string" && otText) {
          const mg = _mergeTrans(_outAcc, otText);
          if (mg !== _outAcc) {
            _outAcc = mg;
            changed = true;
          }
        }
        const parts = sc.modelTurn && sc.modelTurn.parts || sc.parts;
        if (!transcribe && parts && st2().geminiAudioOn !== false) {
          for (const p of parts) {
            const id = p && (p.inlineData || p.inline_data);
            const d = id && id.data;
            if (d) _bufAudio(d);
          }
        }
        if (changed) {
          clearTimeout(_emitTimer);
          _emitTimer = setTimeout(() => _emit(false), PARTIAL_DEBOUNCE_MS);
          const settled = TR_SENT_END.test(_inAcc || "") && (transcribe || TR_SENT_END.test(_outAcc || ""));
          const delay2 = _turnEnded ? INPUT_GRACE_MS : settled ? SETTLE_PAUSE_MS : LONG_IDLE_MS;
          clearTimeout(_flushTimer);
          _flushTimer = setTimeout(_flush, delay2);
          if (!transcribe && st2().geminiAudioOn !== false) _audioBreakOnText();
        }
        if (sc.turnComplete) {
          _turnEnded = true;
          clearTimeout(_flushTimer);
          _flushTimer = setTimeout(_flush, INPUT_GRACE_MS);
          _flushAudio("turn");
        }
      } catch (e) {
        console.warn("[live] msg l\u1ED7i:", e && e.message);
      }
    }
    async function _connect() {
      const ai = new GoogleGenAI2({ apiKey: String(st2().apiKey).trim() });
      const myGen = ++_gen;
      const config = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: { targetLanguageCode: bcp47(st2().langCode), echoTargetLanguage: st2().transcribeMode ? true : false },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: _handle ? { handle: _handle } : {}
      };
      if (!st2().transcribeMode && st2().geminiVoice) {
        config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: st2().geminiVoice } } };
      }
      return ai.live.connect({
        model: MODEL,
        config,
        callbacks: {
          onopen: () => console.log("[live] phi\xEAn m\u1EDF (gen " + myGen + ", \u2192" + bcp47(st2().langCode) + (_handle ? ", resume" : "") + ")"),
          onmessage: (m) => _onMessage(myGen, m),
          onerror: (e) => console.warn("[live] ws error:", e && e.message),
          onclose: () => {
            if (myGen === _gen) {
              _session = null;
              if (_started) _scheduleReconnect();
            }
          }
        }
      });
    }
    async function _ensure() {
      if (!_started || !isConfigured()) return null;
      if (_session) return _session;
      if (_connecting) return _connecting;
      _connecting = (async () => {
        try {
          _session = await _connect();
        } catch (e) {
          console.warn("[live] connect l\u1ED7i:", e && e.message);
          _session = null;
          onStatus({ error: e && e.message });
          if (_started) _scheduleReconnect();
        } finally {
          _connecting = null;
        }
        return _session;
      })();
      return _connecting;
    }
    function _scheduleReconnect() {
      if (!_started) return;
      clearTimeout(_reconnectTimer);
      _reconnectTimer = setTimeout(() => {
        if (_started && !_session && !_connecting) _ensure().catch(() => {
        });
      }, RECONNECT_MS);
    }
    function _closeSession() {
      const s = _session;
      _session = null;
      _gen++;
      if (s) {
        try {
          s.close();
        } catch {
        }
      }
    }
    function _reconnectWithHandle() {
      _closeSession();
      if (_started) _ensure().catch(() => {
      });
    }
    async function pushAudio(f32) {
      if (!_started || !isConfigured() || !f32 || !f32.length) return;
      const sess = await _ensure();
      if (!sess) return;
      try {
        sess.sendRealtimeInput({ audio: { data: _f32ToPcm16B64(f32), mimeType: "audio/pcm;rate=16000" } });
      } catch (e) {
      }
    }
    function start2() {
      if (_started) return;
      if (!isConfigured()) {
        onStatus({ error: "no-key" });
        return;
      }
      _started = true;
      _handle = null;
      _inAcc = "";
      _outAcc = "";
      _resetAudio();
      _ensure().catch(() => {
      });
      console.log("[live] start");
    }
    function stop2() {
      _started = false;
      clearTimeout(_reconnectTimer);
      clearTimeout(_emitTimer);
      clearTimeout(_flushTimer);
      if (_inAcc || _outAcc) _flush();
      _inAcc = "";
      _outAcc = "";
      _handle = null;
      _resetAudio();
      _closeSession();
      onClear();
      console.log("[live] stop");
    }
    function onTargetLangChanged() {
      if (_started) {
        _handle = null;
        _inAcc = "";
        _outAcc = "";
        clearTimeout(_emitTimer);
        clearTimeout(_flushTimer);
        _resetAudio();
        _closeSession();
        _ensure().catch(() => {
        });
      }
    }
    function onTranscribeModeChanged() {
      onTargetLangChanged();
    }
    function onVoiceChanged() {
      if (!_started) return;
      _handle = null;
      _resetAudio();
      _closeSession();
      _ensure().catch(() => {
      });
    }
    function setAudioOn(on) {
      if (!on) {
        _resetAudio();
        onClear();
      }
    }
    const isActive = () => _started;
    return { isConfigured, isActive, pushAudio, start: start2, stop: stop2, onTargetLangChanged, onTranscribeModeChanged, onVoiceChanged, setAudioOn };
  }
  async function validateKey(key) {
    const k = String(key || "").trim();
    if (!k) return { ok: false, error: "empty" };
    try {
      const ai = new GoogleGenAI2({ apiKey: k });
      const pager = await ai.models.list();
      for await (const _m of pager) break;
      return { ok: true };
    } catch (e) {
      const msg = e && e.message || String(e);
      return { ok: false, error: /api[_ ]?key|invalid|400|401|403/i.test(msg) ? "invalid" : msg };
    }
  }

  // extension/lib/gemini-text.js
  var SUMMARY_CHAIN = [
    { id: "gemini-3.1-flash-lite", re: /gemini-3[.\-]?1-flash-lite/i, gemma: false },
    { id: "gemma-4-31b-it", re: /gemma-4-31b/i, gemma: true },
    { id: "gemma-4-26b-it", re: /gemma-4-26b/i, gemma: true }
  ];
  var MAX_PREV_SUMMARY_CHARS = 6e3;
  var MAX_NEW_CAPTIONS = 25;
  var ROLL_OUT_TOKENS = 2048;
  var FULL_OUT_TOKENS = 8192;
  function createSummarizer({ getState }) {
    const S2 = () => getState();
    let _chain = null, _detLang = "";
    const _cooldownUntil = {};
    function _sysSummary() {
      if (!S2().transcribeMode) {
        return `You output ONLY the meeting summary in ${S2().targetLangLabel}, formatted as Markdown. No preface, no commentary, no code fences. Keep IT/technical terms and proper nouns in their original form. Never invent content not in the transcript.`;
      }
      const L = _detLang || "the dominant language of the transcript";
      const ex = (S2().summaryExtra || "").trim();
      return `You output ONLY the meeting summary as Markdown. No preface, no commentary, no code fences. By DEFAULT, write the ENTIRE summary (including ALL section headings) in ${L}. ` + (ex ? `BUT the user's custom instructions below have the HIGHEST priority and OVERRIDE this default \u2014 if they ask for a specific output language or format, obey them. ` : "") + `Keep IT/technical terms and proper nouns in their original form. Never invent content not in the transcript.`;
    }
    function _outLang() {
      return S2().transcribeMode ? _detLang || "ng\xF4n ng\u1EEF chi\u1EBFm \u0111a s\u1ED1 trong transcript" : S2().targetLangLabel;
    }
    function _transcribeNote() {
      if (!S2().transcribeMode) return "";
      const L = _outLang();
      const ex = (S2().summaryExtra || "").trim();
      return `

NG\xD4N NG\u1EEE M\u1EB6C \u0110\u1ECANH = ${L}: vi\u1EBFt TO\xC0N B\u1ED8 b\u1EA3n t\xF3m t\u1EAFt (K\u1EC2 C\u1EA2 ti\xEAu \u0111\u1EC1 m\u1EE5c) b\u1EB1ng ${L}; c\xE1c nh\xE3n ti\u1EBFng Vi\u1EC7t \u1EDF khung tr\xEAn CH\u1EC8 l\xE0 tham chi\u1EBFu \u2192 D\u1ECACH sang ${L}` + (ex ? `. NH\u01AFNG n\u1EBFu "Y\xCAU C\u1EA6U RI\xCANG T\u1EEA NG\u01AF\u1EDCI D\xD9NG" b\xEAn d\u01B0\u1EDBi y\xEAu c\u1EA7u KH\xC1C (k\u1EC3 c\u1EA3 \u0111\u1ED5i ng\xF4n ng\u1EEF) th\xEC THEO y\xEAu c\u1EA7u ri\xEAng \u2014 n\xF3 \u01AFU TI\xCAN CAO NH\u1EA4T.` : `.`);
    }
    function _extraBlock() {
      const x = (S2().summaryExtra || "").trim();
      if (!x) return "";
      return `

## Y\xCAU C\u1EA6U RI\xCANG T\u1EEA NG\u01AF\u1EDCI D\xD9NG (\u01AFU TI\xCAN CAO NH\u1EA4T \u2014 GHI \u0110\xC8 m\u1ECDi quy t\u1EAFc & ng\xF4n ng\u1EEF m\u1EB7c \u0111\u1ECBnh \u1EDF tr\xEAn, k\u1EC3 c\u1EA3 ti\xEAu \u0111\u1EC1 m\u1EE5c; CH\u1EC8 gi\u1EEF quy t\u1EAFc ch\u1ED1ng b\u1ECBa):
${x}`;
    }
    function _trimPrev(s) {
      s = (s || "").trim();
      if (s.length <= MAX_PREV_SUMMARY_CHARS) return s;
      const cut = s.slice(s.length - MAX_PREV_SUMMARY_CHARS);
      const nl = cut.indexOf("\n");
      return (nl > 0 ? cut.slice(nl + 1) : cut).trim();
    }
    function _toLines(captions2, cap) {
      const _t = (c) => (c && (c.translated || c.original) || "").trim();
      let caps = (captions2 || []).filter((c) => _t(c));
      if (cap && caps.length > cap) caps = caps.slice(caps.length - cap);
      return caps.map((c) => `[${c.author || "STT"}] ${_t(c)}`).join("\n");
    }
    function _rawText(captions2, cap) {
      let caps = (captions2 || []).map((c) => c && (c.translated || c.original) || "").filter(Boolean);
      if (cap && caps.length > cap) caps = caps.slice(caps.length - cap);
      return caps.join(" ");
    }
    function _detectLangLabel(text) {
      const s = String(text || "");
      let ja = 0, ko = 0, han = 0, latin = 0, vi = 0;
      for (const ch of s) {
        const c = ch.codePointAt(0);
        if (c >= 12352 && c <= 12543 || c >= 12784 && c <= 12799) ja++;
        else if (c >= 44032 && c <= 55203) ko++;
        else if (c >= 13312 && c <= 40959) han++;
        else if (c >= 65 && c <= 90 || c >= 97 && c <= 122) latin++;
        if (c >= 192 && c <= 7929 && !(c >= 65 && c <= 122)) vi++;
      }
      if (ja > 0) return "ti\u1EBFng Nh\u1EADt (\u65E5\u672C\u8A9E)";
      if (ko > 0) return "ti\u1EBFng H\xE0n (\uD55C\uAD6D\uC5B4)";
      if (han > 0) return "ti\u1EBFng Trung (\u4E2D\u6587)";
      if (vi > 0) return "ti\u1EBFng Vi\u1EC7t";
      if (latin > 0) return "ti\u1EBFng Anh (English)";
      return "";
    }
    function _buildRollingPrompt(prevSummary, captions2) {
      const lines = _toLines(captions2, MAX_NEW_CAPTIONS);
      if (S2().transcribeMode) {
        const d = _detectLangLabel(_rawText(captions2, MAX_NEW_CAPTIONS));
        if (d) _detLang = d;
      }
      prevSummary = _trimPrev(prevSummary);
      const L = _outLang();
      const RULES = `C\u1EA5u tr\xFAc (CH\u1EC8 th\xEAm m\u1EE5c N\xC0O C\xD3 n\u1ED9i dung TH\u1EACT, B\u1ECE m\u1EE5c r\u1ED7ng): ## Ch\u1EE7 \u0111\u1EC1 ch\xEDnh \xB7 ## \u0110i\u1EC3m n\u1ED5i b\u1EADt / V\u1EA5n \u0111\u1EC1 \xB7 ## Quy\u1EBFt \u0111\u1ECBnh & vi\u1EC7c c\u1EA7n l\xE0m (ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch/deadline CH\u1EC8 ghi khi transcript N\xD3I R\xD5).
- GI\u1EEE NGUY\xCAN thu\u1EADt ng\u1EEF IT/ti\u1EBFng Anh & t\xEAn ri\xEAng (bug, deploy, PR, API, sprint, merge, release...).
- T\u1EEB KATAKANA ti\u1EBFng Nh\u1EADt (th\u01B0\u1EDDng l\xE0 t\u1EEB m\u01B0\u1EE3n ti\u1EBFng Anh) \u2192 ghi B\u1EB0NG TI\u1EBENG ANH g\u1ED1c (\u30C7\u30D7\u30ED\u30A4\u2192deploy...), KH\xD4NG d\u1ECBch sang ${L}.
- D\xF9ng B\u1EA2NG Markdown khi c\xF3 s\u1ED1 li\u1EC7u/l\u1ECBch/so s\xE1nh.
- TUY\u1EC6T \u0110\u1ED0I KH\xD4NG B\u1ECAA: ch\u1EC9 t\xF3m t\u1EAFt n\u1ED9i dung C\xD3 TH\u1EACT trong transcript d\u01B0\u1EDBi \u0111\xE2y. KH\xD4NG t\u1EF1 ngh\u0129 ra ch\u1EE7 \u0111\u1EC1/quy\u1EBFt \u0111\u1ECBnh/ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch/deadline/con s\u1ED1 kh\xF4ng xu\u1EA5t hi\u1EC7n trong transcript.
- N\u1EBFu transcript QU\xC1 NG\u1EAEN / ch\u01B0a \u0111\u1EE7 \xFD \u2192 CH\u1EC8 ghi 1-2 c\xE2u m\xF4 t\u1EA3 n\u1ED9i dung th\u1EF1c t\u1EBF (ho\u1EB7c \u0111\xFAng 1 d\xF2ng "Ch\u01B0a \u0111\u1EE7 n\u1ED9i dung \u0111\u1EC3 t\xF3m t\u1EAFt"); KH\xD4NG t\u1EA1o b\u1EA3ng/m\u1EE5c r\u1ED7ng, KH\xD4NG d\u1EF1ng cu\u1ED9c h\u1ECDp t\u01B0\u1EDFng t\u01B0\u1EE3ng.` + _transcribeNote() + _extraBlock();
      if (prevSummary && prevSummary.trim()) {
        return `B\u1EA1n \u0111ang duy tr\xEC B\u1EA2N T\xD3M T\u1EAET cu\u1ED9c h\u1ECDp \u0110ANG DI\u1EC4N RA (Markdown, ${L}). D\u01B0\u1EDBi \u0111\xE2y l\xE0 b\u1EA3n t\xF3m t\u1EAFt hi\u1EC7n t\u1EA1i v\xE0 C\xC1C C\xC2U M\u1EDAI. H\xE3y C\u1EACP NH\u1EACT: g\u1ED9p \xFD m\u1EDBi v\xE0o \u0111\xFAng m\u1EE5c, g\u1ED9p \xFD tr\xF9ng cho c\xF4 \u0111\u1ECDng, KH\xD4NG \u0111\u1EC3 ph\xECnh d\xE0i. Tr\u1EA3 v\u1EC1 TO\xC0N B\u1ED8 b\u1EA3n t\xF3m t\u1EAFt \u0111\xE3 c\u1EADp nh\u1EADt, CH\u1EC8 Markdown, kh\xF4ng l\u1EDDi d\u1EABn.

${RULES}

--- B\u1EA2N T\xD3M T\u1EAET HI\u1EC6N T\u1EA0I ---
${prevSummary}

--- C\xC1C C\xC2U M\u1EDAI ---
${lines || "(kh\xF4ng c\xF3 c\xE2u m\u1EDBi)"}`;
      }
      return `T\xF3m t\u1EAFt cu\u1ED9c h\u1ECDp \u0110ANG DI\u1EC4N RA b\u1EB1ng ${L}, Markdown s\xFAc t\xEDch.
${RULES}

Transcript:
${lines}`;
    }
    function _buildFullReportPrompt(captions2) {
      const lines = _toLines(captions2);
      if (S2().transcribeMode) {
        const d = _detectLangLabel(_rawText(captions2));
        if (d) _detLang = d;
      }
      const L = _outLang();
      return `B\u1EA1n l\xE0 tr\u1EE3 l\xFD t\u1ED5ng h\u1EE3p cu\u1ED9c h\u1ECDp chuy\xEAn nghi\u1EC7p. H\xE3y t\u1EA1o b\xE1o c\xE1o cu\u1ED9c h\u1ECDp chi ti\u1EBFt d\u1EA1ng Markdown t\u1EEB ph\u1EA7n Transcript \u0111\u01B0\u1EE3c cung c\u1EA5p \u1EDF d\u01B0\u1EDBi c\xF9ng.

## Y\xCAU C\u1EA6U TR\xCCNH B\xC0Y:
- Ng\xF4n ng\u1EEF: Vi\u1EBFt ho\xE0n to\xE0n b\u1EB1ng ${L}.
- \u0110\u1ECBnh d\u1EA1ng Markdown chu\u1EA9n: ti\xEAu \u0111\u1EC1 (## / ###), g\u1EA1ch \u0111\u1EA7u d\xF2ng "- ", in \u0111\u1EADm **...** cho \u0111i\u1EC3m quan tr\u1ECDng.
- C\u1EA5u tr\xFAc b\u1EAFt bu\u1ED9c:
  1. T\u1ED5ng quan (Th\u1EDDi gian, th\xE0nh ph\u1EA7n tham gia n\u1EBFu c\xF3, m\u1EE5c \u0111\xEDch ch\xEDnh).
  2. C\xE1c ch\u1EE7 \u0111\u1EC1 ch\xEDnh \u0111\u01B0\u1EE3c th\u1EA3o lu\u1EADn.
  3. V\u1EA5n \u0111\u1EC1 n\u1ED5i b\u1EADt / Kh\xF3 kh\u0103n c\u1EA7n gi\u1EA3i quy\u1EBFt.
  4. Quy\u1EBFt \u0111\u1ECBnh / H\xE0nh \u0111\u1ED9ng ti\u1EBFp theo (k\xE8m ng\u01B0\u1EDDi ph\u1EE5 tr\xE1ch & deadline n\u1EBFu c\xF3 nh\u1EAFc t\u1EDBi).

## QUY T\u1EAEC THU\u1EACT NG\u1EEE:
- GI\u1EEE NGUY\xCAN ti\u1EBFng Anh/nguy\xEAn g\u1ED1c c\xE1c thu\u1EADt ng\u1EEF IT & t\xEAn ri\xEAng (bug, sprint, deploy, release, build, merge, PR, API, server, database, review, commit, branch, schedule, deadline, task, issue, ticket, repo, CI/CD, hotfix...). Ch\u1EC9 d\u1ECBch ph\u1EA7n di\u1EC5n gi\u1EA3i.
- T\u1EEB KATAKANA ti\u1EBFng Nh\u1EADt \u2192 KH\xD4I PH\u1EE4C v\u1EC1 TI\u1EBENG ANH g\u1ED1c (\u30C7\u30D7\u30ED\u30A4\u2192deploy, \u30B9\u30B1\u30B8\u30E5\u30FC\u30EB\u2192schedule...), KH\xD4NG phi\xEAn \xE2m/d\u1ECBch sang ${L}.

## QUY T\u1EAEC B\u1EA2NG:
- C\xF3 s\u1ED1 li\u1EC7u/m\u1ED1c th\u1EDDi gian/l\u1ECBch tr\xECnh/so s\xE1nh \u2192 B\u1EAET BU\u1ED8C d\xF9ng B\u1EA2NG Markdown.

## NGUY\xCAN T\u1EAEC TRUNG TH\u1EF0C:
- Kh\xF4ng suy di\u1EC5n, kh\xF4ng b\u1ECBa. Thi\u1EBFu th\xF4ng tin \u2192 \u0111\u1EC3 tr\u1ED1ng ho\u1EB7c "Ch\u01B0a x\xE1c \u0111\u1ECBnh".

${_transcribeNote()}${_extraBlock()}
---
B\u1EAET \u0110\u1EA6U TRANSCRIPT CU\u1ED8C H\u1ECCP:
${lines}`;
    }
    async function _resolveChain(ai) {
      if (_chain) return _chain;
      const names = [];
      try {
        const pager = await ai.models.list();
        for await (const m of pager) {
          const name = String(m && m.name || "").replace(/^models\//, "");
          const acts = m && (m.supportedActions || m.supportedGenerationMethods) || [];
          if (name && Array.isArray(acts) && acts.some((a) => /generateContent/i.test(String(a)))) names.push(name);
        }
      } catch (e) {
        console.warn("[summary] ListModels l\u1ED7i \u2192 id m\u1EB7c \u0111\u1ECBnh:", e && e.message);
      }
      _chain = SUMMARY_CHAIN.map((c) => ({ id: names.find((n) => c.re.test(n)) || c.id, gemma: c.gemma }));
      console.log("[summary] chain:", _chain.map((c) => c.id).join(" \u2192 "));
      return _chain;
    }
    const _onCooldown = (id) => {
      const t2 = _cooldownUntil[id];
      return !!t2 && Date.now() < t2;
    };
    const _isQuota = (msg) => /\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);
    function _setCooldown(id, msg) {
      const daily = /per\s*day|perday|daily|RequestsPerDay/i.test(msg);
      _cooldownUntil[id] = Date.now() + (daily ? 4 * 36e5 : 9e4);
    }
    async function _generate(ai, entry, prompt, { withSys = true, maxOut = ROLL_OUT_TOKENS } = {}) {
      const config = { temperature: 0.3, maxOutputTokens: maxOut };
      let contents = prompt;
      if (withSys) {
        const sys = _sysSummary();
        if (entry.gemma) contents = sys + "\n\n" + prompt;
        else config.systemInstruction = sys;
      }
      const res = await ai.models.generateContent({ model: entry.id, contents, config });
      return res && (typeof res.text === "string" ? res.text : res.text && res.text()) || "";
    }
    async function _runChain(ai, chain, prompt, opts) {
      let lastErr = "no-model", skippedAll = true;
      for (const entry of chain) {
        if (_onCooldown(entry.id)) continue;
        skippedAll = false;
        try {
          const text = await _generate(ai, entry, prompt, opts);
          if (text && text.trim()) return { ok: true, markdown: text.trim(), model: entry.id };
          lastErr = "empty-response";
        } catch (e) {
          const msg = e && e.message || String(e);
          lastErr = msg;
          if (_isQuota(msg)) {
            _setCooldown(entry.id, msg);
            console.warn(`[summary] ${entry.id} 429 \u2192 fallback`);
            continue;
          }
          if (/not found|not supported|404/i.test(msg)) {
            console.warn(`[summary] ${entry.id} kh\xF4ng kh\u1EA3 d\u1EE5ng \u2192 fallback`);
            continue;
          }
          console.warn(`[summary] ${entry.id} l\u1ED7i: ${msg} \u2192 model k\u1EBF`);
        }
      }
      if (skippedAll && chain.length) {
        const last = chain[chain.length - 1];
        try {
          const text = await _generate(ai, last, prompt, opts);
          if (text && text.trim()) return { ok: true, markdown: text.trim(), model: last.id };
        } catch (e) {
          lastErr = e && e.message || String(e);
        }
      }
      return { ok: false, error: lastErr };
    }
    const _ai = () => new GoogleGenAI2({ apiKey: String(S2().apiKey).trim() });
    async function summarize(payload) {
      const prevSummary = payload && payload.prevSummary || "";
      const captions2 = payload && payload.captions || (Array.isArray(payload) ? payload : []);
      if (!S2().apiKey || !String(S2().apiKey).trim()) return { ok: false, error: "no-key" };
      if ((!captions2 || !captions2.length) && !prevSummary) return { ok: false, error: "empty" };
      const ai = _ai();
      return _runChain(ai, await _resolveChain(ai), _buildRollingPrompt(prevSummary, captions2), { withSys: true, maxOut: ROLL_OUT_TOKENS });
    }
    async function summarizeFull(captions2) {
      captions2 = captions2 || [];
      if (!S2().apiKey || !String(S2().apiKey).trim()) return { ok: false, error: "no-key" };
      if (!captions2.length) return { ok: false, error: "empty" };
      const ai = _ai();
      const chain = await _resolveChain(ai);
      const gemma = chain.filter((c) => c.gemma);
      return _runChain(ai, gemma.length ? gemma : chain, _buildFullReportPrompt(captions2), { withSys: false, maxOut: FULL_OUT_TOKENS });
    }
    return { summarize, summarizeFull };
  }

  // extension/lib/voices.js
  var GEM_VOICES = [
    "Achernar",
    "Aoede",
    "Sulafat",
    "Vindemiatrix",
    "Achird",
    "Kore",
    "Charon",
    "Puck",
    "Zephyr",
    "Leda",
    "Fenrir",
    "Orus",
    "Callirrhoe",
    "Autonoe",
    "Umbriel",
    "Despina",
    "Algieba",
    "Erinome",
    "Iapetus",
    "Laomedeia",
    "Schedar",
    "Gacrux",
    "Sadachbia",
    "Sadaltager",
    "Alnilam",
    "Enceladus",
    "Algenib",
    "Rasalgethi",
    "Pulcherrima",
    "Zubenelgenubi"
  ];
  var DEFAULT_VOICE = "Achernar";

  // extension/lib/i18n.js
  var FLAGS = {
    vi: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#da251d"/><path d="M15 4.2l1.62 4.98h5.24l-4.24 3.08 1.62 4.98L15 14.14l-4.24 3.08 1.62-4.98-4.24-3.08h5.24z" fill="#ff0"/></svg>`,
    en: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><g fill="#b22234"><rect width="30" height="2" y="0"/><rect width="30" height="2" y="4"/><rect width="30" height="2" y="8"/><rect width="30" height="2" y="12"/><rect width="30" height="2" y="16"/></g><rect width="13" height="11" fill="#3c3b6e"/></svg>`,
    ja: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5.5" fill="#bc002d"/></svg>`,
    ko: `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5" fill="#cd2e3a"/><path d="M15 5a2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0 0 5 5 5 0 0 1 0-10z" fill="#0047a0"/></svg>`,
    "zh-CN": `<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#de2910"/><path d="M6 3.6l1.13 3.48h3.66l-2.96 2.15 1.13 3.48L6 10.56l-2.96 2.15 1.13-3.48L1.21 7.08h3.66z" fill="#ffde00"/><g fill="#ffde00"><circle cx="12" cy="3" r=".8"/><circle cx="14" cy="5.2" r=".8"/><circle cx="14" cy="8.2" r=".8"/><circle cx="12" cy="10.4" r=".8"/></g></svg>`
  };
  var flag = (code) => FLAGS[code] || FLAGS[(code || "").split("-")[0]] || "";
  var I18N_LOCALES = [
    { code: "vi", name: "Ti\u1EBFng Vi\u1EC7t" },
    { code: "en", name: "English" },
    { code: "ja", name: "\u65E5\u672C\u8A9E" },
    { code: "ko", name: "\uD55C\uAD6D\uC5B4" },
    { code: "zh-CN", name: "\u4E2D\u6587" }
  ];
  var I18N = {
    vi: {
      settings: "C\xE0i \u0111\u1EB7t",
      "settings.apiKey": "Gemini API key",
      "settings.source": "Ngu\u1ED3n \xE2m thanh",
      "settings.targetLang": "Ng\xF4n ng\u1EEF \u0111\xEDch",
      "uilang.title": "Ng\xF4n ng\u1EEF giao di\u1EC7n",
      "popout.title": "M\u1EDF trong tab ri\xEAng",
      "apiKey.ph": "AIza\u2026",
      "source.mic": "\u{1F3A4} Micro",
      "source.screen": "\u{1F50A} \xC2m thanh (tab / m\xE0n h\xECnh / c\u1EEDa s\u1ED5)",
      "lang.transcribe": "\u{1F4DD} Ch\xE9p l\u1EDDi",
      "voice.off": "\u{1F507} T\u1EAFt \u0111\u1ECDc",
      "btn.start": "\u25B6 B\u1EAFt \u0111\u1EA7u",
      "btn.stop": "\u23F9 D\u1EEBng",
      "footer.auto": "\u2193 Auto",
      "footer.autoTitle": "T\u1EF1 cu\u1ED9n",
      "footer.summary": "\u{1F4CB} T\xF3m t\u1EAFt",
      "footer.exportTitle": "Xu\u1EA5t transcript",
      "footer.clearTitle": "Xo\xE1",
      "footer.orig": "G\u1ED1c",
      "footer.origTitle": "Hi\u1EC7n/\u1EA9n l\u1EDDi g\u1ED1c",
      "summary.title": "T\xF3m t\u1EAFt",
      "summary.full": "\u{1F4CA} T\u1ED5ng th\u1EC3",
      "summary.fullTitle": "B\xE1o c\xE1o t\u1ED5ng th\u1EC3 (khi \u0111\xE3 d\u1EEBng)",
      "summary.copyTitle": "Copy",
      "summary.exportTitle": "Xu\u1EA5t .md",
      "summary.editTitle": "S\u1EEDa y\xEAu c\u1EA7u t\xF3m t\u1EAFt",
      "summary.empty": "Ch\u01B0a c\xF3 t\xF3m t\u1EAFt.",
      "summary.extraPh": "VD: t\u1EADp trung v\xE0o quy\u1EBFt \u0111\u1ECBnh & deadline",
      "summary.save": "L\u01B0u",
      "summary.updating": "\u0110ang c\u1EADp nh\u1EADt t\xF3m t\u1EAFt\u2026",
      count: "{n} c\xE2u",
      "status.ready": "S\u1EB5n s\xE0ng. B\u1EA5m B\u1EAFt \u0111\u1EA7u.",
      "status.readyNoKey": "Nh\u1EADp API key (\u2699\uFE0F) r\u1ED3i b\u1EA5m B\u1EAFt \u0111\u1EA7u.",
      "status.needKey": "Nh\u1EADp Gemini API key tr\u01B0\u1EDBc.",
      "status.listeningMic": "\u0110ang nghe micro\u2026",
      "status.listeningAudio": "\u0110ang nghe \xE2m thanh \u0111\xE3 ch\u1ECDn\u2026",
      "status.stopped": "\u0110\xE3 d\u1EEBng.",
      "status.canceled": "\u0110\xE3 hu\u1EF7 ch\u1ECDn ngu\u1ED3n \xE2m thanh.",
      "status.captureErr": "L\u1ED7i thu \xE2m: {err}",
      "status.checking": "\u0110ang ki\u1EC3m tra\u2026",
      "status.keyOk": "\u2713 Key h\u1EE3p l\u1EC7",
      "status.keyBad": "\u2715 Key kh\xF4ng h\u1EE3p l\u1EC7",
      "status.copied": "\u0110\xE3 copy t\xF3m t\u1EAFt.",
      "status.makingFull": "\u0110ang t\u1EA1o b\xE1o c\xE1o t\u1ED5ng th\u1EC3\u2026",
      "status.fullDone": "Xong b\xE1o c\xE1o t\u1ED5ng th\u1EC3.",
      "status.fullErr": "B\xE1o c\xE1o l\u1ED7i: {err}",
      "status.noContent": "Ch\u01B0a c\xF3 n\u1ED9i dung.",
      "status.summaryErr": "T\xF3m t\u1EAFt: {err}",
      "status.stopFirst": "D\u1EEBng ghi tr\u01B0\u1EDBc khi t\u1EA1o b\xE1o c\xE1o t\u1ED5ng th\u1EC3.",
      "status.popoutErr": "Kh\xF4ng m\u1EDF \u0111\u01B0\u1EE3c c\u1EEDa s\u1ED5 ri\xEAng: {err}",
      "pip.title": "Ghim c\u1EEDa s\u1ED5 n\u1ED5i (PiP \u2014 lu\xF4n tr\xEAn c\xF9ng)",
      "pip.active": "\u0110ang hi\u1EC3n th\u1ECB \u1EDF c\u1EEDa s\u1ED5 ghim (PiP). \u0110\xF3ng PiP \u0111\u1EC3 \u0111\u01B0a n\u1ED9i dung v\u1EC1 \u0111\xE2y.",
      "status.pipUnsupported": "Tr\xECnh duy\u1EC7t kh\xF4ng h\u1ED7 tr\u1EE3 Document Picture-in-Picture.",
      "status.pipErr": "L\u1ED7i m\u1EDF PiP: {err}",
      "pip.return": "Quay v\u1EC1 c\u1EEDa s\u1ED5 g\u1ED1c",
      "status.micPermNeeded": '\u0110ang xin quy\u1EC1n micro \u1EDF c\u1EEDa s\u1ED5 v\u1EEBa m\u1EDF \u2014 ch\u1ECDn "Cho ph\xE9p" r\u1ED3i b\u1EA5m B\u1EAFt \u0111\u1EA7u l\u1EA1i.',
      "status.micGranted": "\u2705 \u0110\xE3 c\u1EA5p quy\u1EC1n micro.",
      "status.micPermHint": "\u{1F3A4} Micro ch\u01B0a \u0111\u01B0\u1EE3c c\u1EA5p quy\u1EC1n \u2014 b\u1EA5m B\u1EAFt \u0111\u1EA7u \u0111\u1EC3 c\u1EA5p.",
      "status.summaryApplied": "\u0110\xE3 \xE1p d\u1EE5ng y\xEAu c\u1EA7u & t\xF3m t\u1EAFt l\u1EA1i.",
      "status.noKeyShort": "Thi\u1EBFu API key.",
      "status.geminiErr": "Gemini: {err}"
    },
    en: {
      settings: "Settings",
      "settings.apiKey": "Gemini API key",
      "settings.source": "Audio source",
      "settings.targetLang": "Target language",
      "uilang.title": "Interface language",
      "popout.title": "Open in a separate tab",
      "apiKey.ph": "AIza\u2026",
      "source.mic": "\u{1F3A4} Microphone",
      "source.screen": "\u{1F50A} Audio (tab / screen / window)",
      "lang.transcribe": "\u{1F4DD} Transcribe",
      "voice.off": "\u{1F507} Voice off",
      "btn.start": "\u25B6 Start",
      "btn.stop": "\u23F9 Stop",
      "footer.auto": "\u2193 Auto",
      "footer.autoTitle": "Auto-scroll",
      "footer.summary": "\u{1F4CB} Summary",
      "footer.exportTitle": "Export transcript",
      "footer.clearTitle": "Clear",
      "footer.orig": "Source",
      "footer.origTitle": "Show/hide original",
      "summary.title": "Summary",
      "summary.full": "\u{1F4CA} Full report",
      "summary.fullTitle": "Full meeting report (after stopping)",
      "summary.copyTitle": "Copy",
      "summary.exportTitle": "Export .md",
      "summary.editTitle": "Edit summary instructions",
      "summary.empty": "No summary yet.",
      "summary.extraPh": "e.g. focus on decisions & deadlines",
      "summary.save": "Save",
      "summary.updating": "Updating summary\u2026",
      count: "{n} lines",
      "status.ready": "Ready. Click Start.",
      "status.readyNoKey": "Enter API key (\u2699\uFE0F) then click Start.",
      "status.needKey": "Enter your Gemini API key first.",
      "status.listeningMic": "Listening to microphone\u2026",
      "status.listeningAudio": "Listening to selected audio\u2026",
      "status.stopped": "Stopped.",
      "status.canceled": "Audio source selection canceled.",
      "status.captureErr": "Capture error: {err}",
      "status.checking": "Checking\u2026",
      "status.keyOk": "\u2713 Key valid",
      "status.keyBad": "\u2715 Invalid key",
      "status.copied": "Summary copied.",
      "status.makingFull": "Generating full report\u2026",
      "status.fullDone": "Full report done.",
      "status.fullErr": "Report error: {err}",
      "status.noContent": "No content yet.",
      "status.summaryErr": "Summary: {err}",
      "status.stopFirst": "Stop recording before generating the full report.",
      "status.popoutErr": "Could not open separate window: {err}",
      "pip.title": "Pin floating window (PiP \u2014 always on top)",
      "pip.active": "Now shown in the pinned (PiP) window. Close PiP to bring it back here.",
      "status.pipUnsupported": "Browser does not support Document Picture-in-Picture.",
      "status.pipErr": "PiP error: {err}",
      "pip.return": "Return to original window",
      "status.micPermNeeded": 'Requesting mic permission in the opened window \u2014 choose "Allow", then press Start again.',
      "status.micGranted": "\u2705 Microphone permission granted.",
      "status.micPermHint": "\u{1F3A4} Microphone not granted yet \u2014 press Start to grant.",
      "status.summaryApplied": "Instructions applied & re-summarized.",
      "status.noKeyShort": "Missing API key.",
      "status.geminiErr": "Gemini: {err}"
    },
    ja: {
      settings: "\u8A2D\u5B9A",
      "settings.apiKey": "Gemini API \u30AD\u30FC",
      "settings.source": "\u97F3\u58F0\u30BD\u30FC\u30B9",
      "settings.targetLang": "\u7FFB\u8A33\u5148\u306E\u8A00\u8A9E",
      "uilang.title": "\u8868\u793A\u8A00\u8A9E",
      "popout.title": "\u5225\u30BF\u30D6\u3067\u958B\u304F",
      "apiKey.ph": "AIza\u2026",
      "source.mic": "\u{1F3A4} \u30DE\u30A4\u30AF",
      "source.screen": "\u{1F50A} \u97F3\u58F0\uFF08\u30BF\u30D6 / \u753B\u9762 / \u30A6\u30A3\u30F3\u30C9\u30A6\uFF09",
      "lang.transcribe": "\u{1F4DD} \u6587\u5B57\u8D77\u3053\u3057",
      "voice.off": "\u{1F507} \u8AAD\u307F\u4E0A\u3052\u30AA\u30D5",
      "btn.start": "\u25B6 \u958B\u59CB",
      "btn.stop": "\u23F9 \u505C\u6B62",
      "footer.auto": "\u2193 \u81EA\u52D5",
      "footer.autoTitle": "\u81EA\u52D5\u30B9\u30AF\u30ED\u30FC\u30EB",
      "footer.summary": "\u{1F4CB} \u8981\u7D04",
      "footer.exportTitle": "\u6587\u5B57\u8D77\u3053\u3057\u3092\u66F8\u304D\u51FA\u3059",
      "footer.clearTitle": "\u30AF\u30EA\u30A2",
      "footer.orig": "\u539F\u6587",
      "footer.origTitle": "\u539F\u6587\u306E\u8868\u793A/\u975E\u8868\u793A",
      "summary.title": "\u8981\u7D04",
      "summary.full": "\u{1F4CA} \u5168\u4F53\u30EC\u30DD\u30FC\u30C8",
      "summary.fullTitle": "\u4F1A\u8B70\u5168\u4F53\u306E\u30EC\u30DD\u30FC\u30C8\uFF08\u505C\u6B62\u5F8C\uFF09",
      "summary.copyTitle": "\u30B3\u30D4\u30FC",
      "summary.exportTitle": ".md \u3067\u66F8\u304D\u51FA\u3059",
      "summary.editTitle": "\u8981\u7D04\u306E\u6307\u793A\u3092\u7DE8\u96C6",
      "summary.empty": "\u307E\u3060\u8981\u7D04\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
      "summary.extraPh": "\u4F8B\uFF1A\u6C7A\u5B9A\u4E8B\u9805\u3068\u671F\u9650\u3092\u91CD\u8996",
      "summary.save": "\u4FDD\u5B58",
      "summary.updating": "\u8981\u7D04\u3092\u66F4\u65B0\u4E2D\u2026",
      count: "{n} \u884C",
      "status.ready": "\u6E96\u5099\u5B8C\u4E86\u3002\u958B\u59CB\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "status.readyNoKey": "API \u30AD\u30FC\uFF08\u2699\uFE0F\uFF09\u3092\u5165\u529B\u3057\u3066\u304B\u3089\u958B\u59CB\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "status.needKey": "\u5148\u306B Gemini API \u30AD\u30FC\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "status.listeningMic": "\u30DE\u30A4\u30AF\u3092\u805E\u3044\u3066\u3044\u307E\u3059\u2026",
      "status.listeningAudio": "\u9078\u629E\u3057\u305F\u97F3\u58F0\u3092\u805E\u3044\u3066\u3044\u307E\u3059\u2026",
      "status.stopped": "\u505C\u6B62\u3057\u307E\u3057\u305F\u3002",
      "status.canceled": "\u97F3\u58F0\u30BD\u30FC\u30B9\u306E\u9078\u629E\u3092\u30AD\u30E3\u30F3\u30BB\u30EB\u3057\u307E\u3057\u305F\u3002",
      "status.captureErr": "\u9332\u97F3\u30A8\u30E9\u30FC: {err}",
      "status.checking": "\u78BA\u8A8D\u4E2D\u2026",
      "status.keyOk": "\u2713 \u30AD\u30FC\u306F\u6709\u52B9\u3067\u3059",
      "status.keyBad": "\u2715 \u30AD\u30FC\u304C\u7121\u52B9\u3067\u3059",
      "status.copied": "\u8981\u7D04\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002",
      "status.makingFull": "\u5168\u4F53\u30EC\u30DD\u30FC\u30C8\u3092\u4F5C\u6210\u4E2D\u2026",
      "status.fullDone": "\u5168\u4F53\u30EC\u30DD\u30FC\u30C8\u5B8C\u4E86\u3002",
      "status.fullErr": "\u30EC\u30DD\u30FC\u30C8\u30A8\u30E9\u30FC: {err}",
      "status.noContent": "\u5185\u5BB9\u304C\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002",
      "status.summaryErr": "\u8981\u7D04: {err}",
      "status.stopFirst": "\u5168\u4F53\u30EC\u30DD\u30FC\u30C8\u3092\u4F5C\u6210\u3059\u308B\u524D\u306B\u505C\u6B62\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "status.popoutErr": "\u5225\u30A6\u30A3\u30F3\u30C9\u30A6\u3092\u958B\u3051\u307E\u305B\u3093: {err}",
      "pip.title": "\u30D5\u30ED\u30FC\u30C6\u30A3\u30F3\u30B0\u56FA\u5B9A\uFF08PiP\u30FB\u5E38\u306B\u6700\u524D\u9762\uFF09",
      "pip.active": "\u56FA\u5B9A\uFF08PiP\uFF09\u30A6\u30A3\u30F3\u30C9\u30A6\u306B\u8868\u793A\u4E2D\u3002PiP \u3092\u9589\u3058\u308B\u3068\u3053\u3053\u306B\u623B\u308A\u307E\u3059\u3002",
      "status.pipUnsupported": "\u3053\u306E\u30D6\u30E9\u30A6\u30B6\u306F Document Picture-in-Picture \u306B\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
      "status.pipErr": "PiP \u30A8\u30E9\u30FC: {err}",
      "pip.return": "\u5143\u306E\u30A6\u30A3\u30F3\u30C9\u30A6\u306B\u623B\u3059",
      "status.micPermNeeded": "\u958B\u3044\u305F\u30A6\u30A3\u30F3\u30C9\u30A6\u3067\u30DE\u30A4\u30AF\u6A29\u9650\u3092\u30EA\u30AF\u30A8\u30B9\u30C8\u4E2D \u2014 \u300C\u8A31\u53EF\u300D\u3092\u9078\u3093\u3067\u304B\u3089\u300C\u958B\u59CB\u300D\u3092\u62BC\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "status.micGranted": "\u2705 \u30DE\u30A4\u30AF\u6A29\u9650\u3092\u8A31\u53EF\u3057\u307E\u3057\u305F\u3002",
      "status.micPermHint": "\u{1F3A4} \u30DE\u30A4\u30AF\u672A\u8A31\u53EF \u2014\u300C\u958B\u59CB\u300D\u3067\u8A31\u53EF\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "status.summaryApplied": "\u6307\u793A\u3092\u9069\u7528\u3057\u3066\u518D\u8981\u7D04\u3057\u307E\u3057\u305F\u3002",
      "status.noKeyShort": "API \u30AD\u30FC\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
      "status.geminiErr": "Gemini: {err}"
    },
    ko: {
      settings: "\uC124\uC815",
      "settings.apiKey": "Gemini API \uD0A4",
      "settings.source": "\uC624\uB514\uC624 \uC18C\uC2A4",
      "settings.targetLang": "\uB300\uC0C1 \uC5B8\uC5B4",
      "uilang.title": "\uD45C\uC2DC \uC5B8\uC5B4",
      "popout.title": "\uBCC4\uB3C4 \uD0ED\uC73C\uB85C \uC5F4\uAE30",
      "apiKey.ph": "AIza\u2026",
      "source.mic": "\u{1F3A4} \uB9C8\uC774\uD06C",
      "source.screen": "\u{1F50A} \uC624\uB514\uC624 (\uD0ED / \uD654\uBA74 / \uCC3D)",
      "lang.transcribe": "\u{1F4DD} \uBC1B\uC544\uC4F0\uAE30",
      "voice.off": "\u{1F507} \uC74C\uC131 \uB044\uAE30",
      "btn.start": "\u25B6 \uC2DC\uC791",
      "btn.stop": "\u23F9 \uC911\uC9C0",
      "footer.auto": "\u2193 \uC790\uB3D9",
      "footer.autoTitle": "\uC790\uB3D9 \uC2A4\uD06C\uB864",
      "footer.summary": "\u{1F4CB} \uC694\uC57D",
      "footer.exportTitle": "\uC804\uC0AC \uB0B4\uBCF4\uB0B4\uAE30",
      "footer.clearTitle": "\uC9C0\uC6B0\uAE30",
      "footer.orig": "\uC6D0\uBB38",
      "footer.origTitle": "\uC6D0\uBB38 \uD45C\uC2DC/\uC228\uAE30\uAE30",
      "summary.title": "\uC694\uC57D",
      "summary.full": "\u{1F4CA} \uC804\uCCB4 \uBCF4\uACE0\uC11C",
      "summary.fullTitle": "\uC804\uCCB4 \uD68C\uC758 \uBCF4\uACE0\uC11C (\uC911\uC9C0 \uD6C4)",
      "summary.copyTitle": "\uBCF5\uC0AC",
      "summary.exportTitle": ".md \uB0B4\uBCF4\uB0B4\uAE30",
      "summary.editTitle": "\uC694\uC57D \uC9C0\uC2DC \uD3B8\uC9D1",
      "summary.empty": "\uC544\uC9C1 \uC694\uC57D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
      "summary.extraPh": "\uC608: \uACB0\uC815 \uC0AC\uD56D\uACFC \uB9C8\uAC10\uC77C \uC911\uC2EC",
      "summary.save": "\uC800\uC7A5",
      "summary.updating": "\uC694\uC57D \uC5C5\uB370\uC774\uD2B8 \uC911\u2026",
      count: "{n}\uC904",
      "status.ready": "\uC900\uBE44\uB428. \uC2DC\uC791\uC744 \uB204\uB974\uC138\uC694.",
      "status.readyNoKey": "API \uD0A4(\u2699\uFE0F)\uB97C \uC785\uB825\uD55C \uD6C4 \uC2DC\uC791\uC744 \uB204\uB974\uC138\uC694.",
      "status.needKey": "\uBA3C\uC800 Gemini API \uD0A4\uB97C \uC785\uB825\uD558\uC138\uC694.",
      "status.listeningMic": "\uB9C8\uC774\uD06C\uB97C \uB4E3\uB294 \uC911\u2026",
      "status.listeningAudio": "\uC120\uD0DD\uD55C \uC624\uB514\uC624\uB97C \uB4E3\uB294 \uC911\u2026",
      "status.stopped": "\uC911\uC9C0\uB428.",
      "status.canceled": "\uC624\uB514\uC624 \uC18C\uC2A4 \uC120\uD0DD\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
      "status.captureErr": "\uB179\uC74C \uC624\uB958: {err}",
      "status.checking": "\uD655\uC778 \uC911\u2026",
      "status.keyOk": "\u2713 \uC720\uD6A8\uD55C \uD0A4",
      "status.keyBad": "\u2715 \uC798\uBABB\uB41C \uD0A4",
      "status.copied": "\uC694\uC57D\uC744 \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.",
      "status.makingFull": "\uC804\uCCB4 \uBCF4\uACE0\uC11C \uC0DD\uC131 \uC911\u2026",
      "status.fullDone": "\uC804\uCCB4 \uBCF4\uACE0\uC11C \uC644\uB8CC.",
      "status.fullErr": "\uBCF4\uACE0\uC11C \uC624\uB958: {err}",
      "status.noContent": "\uC544\uC9C1 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
      "status.summaryErr": "\uC694\uC57D: {err}",
      "status.stopFirst": "\uC804\uCCB4 \uBCF4\uACE0\uC11C\uB97C \uB9CC\uB4E4\uAE30 \uC804\uC5D0 \uB179\uC74C\uC744 \uC911\uC9C0\uD558\uC138\uC694.",
      "status.popoutErr": "\uBCC4\uB3C4 \uCC3D\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: {err}",
      "pip.title": "\uD50C\uB85C\uD305 \uACE0\uC815 (PiP \u2014 \uD56D\uC0C1 \uC704)",
      "pip.active": "\uACE0\uC815(PiP) \uCC3D\uC5D0 \uD45C\uC2DC \uC911\uC785\uB2C8\uB2E4. PiP\uB97C \uB2EB\uC73C\uBA74 \uC5EC\uAE30\uB85C \uB3CC\uC544\uC635\uB2C8\uB2E4.",
      "status.pipUnsupported": "\uC774 \uBE0C\uB77C\uC6B0\uC800\uB294 Document Picture-in-Picture\uB97C \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
      "status.pipErr": "PiP \uC624\uB958: {err}",
      "pip.return": "\uC6D0\uB798 \uCC3D\uC73C\uB85C \uBCF5\uADC0",
      "status.micPermNeeded": '\uC5F4\uB9B0 \uCC3D\uC5D0\uC11C \uB9C8\uC774\uD06C \uAD8C\uD55C \uC694\uCCAD \uC911 \u2014 "\uD5C8\uC6A9"\uC744 \uC120\uD0DD\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uC791\uC744 \uB204\uB974\uC138\uC694.',
      "status.micGranted": "\u2705 \uB9C8\uC774\uD06C \uAD8C\uD55C\uC774 \uD5C8\uC6A9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
      "status.micPermHint": "\u{1F3A4} \uB9C8\uC774\uD06C \uBBF8\uD5C8\uC6A9 \u2014 \uC2DC\uC791\uC744 \uB20C\uB7EC \uD5C8\uC6A9\uD558\uC138\uC694.",
      "status.summaryApplied": "\uC9C0\uC2DC\uB97C \uC801\uC6A9\uD558\uACE0 \uB2E4\uC2DC \uC694\uC57D\uD588\uC2B5\uB2C8\uB2E4.",
      "status.noKeyShort": "API \uD0A4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.",
      "status.geminiErr": "Gemini: {err}"
    },
    "zh-CN": {
      settings: "\u8BBE\u7F6E",
      "settings.apiKey": "Gemini API \u5BC6\u94A5",
      "settings.source": "\u97F3\u9891\u6765\u6E90",
      "settings.targetLang": "\u76EE\u6807\u8BED\u8A00",
      "uilang.title": "\u754C\u9762\u8BED\u8A00",
      "popout.title": "\u5728\u5355\u72EC\u6807\u7B7E\u9875\u4E2D\u6253\u5F00",
      "apiKey.ph": "AIza\u2026",
      "source.mic": "\u{1F3A4} \u9EA6\u514B\u98CE",
      "source.screen": "\u{1F50A} \u97F3\u9891\uFF08\u6807\u7B7E\u9875 / \u5C4F\u5E55 / \u7A97\u53E3\uFF09",
      "lang.transcribe": "\u{1F4DD} \u8F6C\u5199",
      "voice.off": "\u{1F507} \u5173\u95ED\u6717\u8BFB",
      "btn.start": "\u25B6 \u5F00\u59CB",
      "btn.stop": "\u23F9 \u505C\u6B62",
      "footer.auto": "\u2193 \u81EA\u52A8",
      "footer.autoTitle": "\u81EA\u52A8\u6EDA\u52A8",
      "footer.summary": "\u{1F4CB} \u6458\u8981",
      "footer.exportTitle": "\u5BFC\u51FA\u8F6C\u5199",
      "footer.clearTitle": "\u6E05\u9664",
      "footer.orig": "\u539F\u6587",
      "footer.origTitle": "\u663E\u793A/\u9690\u85CF\u539F\u6587",
      "summary.title": "\u6458\u8981",
      "summary.full": "\u{1F4CA} \u5B8C\u6574\u62A5\u544A",
      "summary.fullTitle": "\u5B8C\u6574\u4F1A\u8BAE\u62A5\u544A\uFF08\u505C\u6B62\u540E\uFF09",
      "summary.copyTitle": "\u590D\u5236",
      "summary.exportTitle": "\u5BFC\u51FA .md",
      "summary.editTitle": "\u7F16\u8F91\u6458\u8981\u8981\u6C42",
      "summary.empty": "\u6682\u65E0\u6458\u8981\u3002",
      "summary.extraPh": "\u4F8B\u5982\uFF1A\u805A\u7126\u51B3\u7B56\u4E0E\u622A\u6B62\u65E5\u671F",
      "summary.save": "\u4FDD\u5B58",
      "summary.updating": "\u6B63\u5728\u66F4\u65B0\u6458\u8981\u2026",
      count: "{n} \u884C",
      "status.ready": "\u5C31\u7EEA\u3002\u70B9\u51FB\u5F00\u59CB\u3002",
      "status.readyNoKey": "\u8F93\u5165 API \u5BC6\u94A5\uFF08\u2699\uFE0F\uFF09\u540E\u70B9\u51FB\u5F00\u59CB\u3002",
      "status.needKey": "\u8BF7\u5148\u8F93\u5165 Gemini API \u5BC6\u94A5\u3002",
      "status.listeningMic": "\u6B63\u5728\u8046\u542C\u9EA6\u514B\u98CE\u2026",
      "status.listeningAudio": "\u6B63\u5728\u8046\u542C\u6240\u9009\u97F3\u9891\u2026",
      "status.stopped": "\u5DF2\u505C\u6B62\u3002",
      "status.canceled": "\u5DF2\u53D6\u6D88\u97F3\u9891\u6765\u6E90\u9009\u62E9\u3002",
      "status.captureErr": "\u5F55\u5236\u9519\u8BEF\uFF1A{err}",
      "status.checking": "\u68C0\u67E5\u4E2D\u2026",
      "status.keyOk": "\u2713 \u5BC6\u94A5\u6709\u6548",
      "status.keyBad": "\u2715 \u5BC6\u94A5\u65E0\u6548",
      "status.copied": "\u5DF2\u590D\u5236\u6458\u8981\u3002",
      "status.makingFull": "\u6B63\u5728\u751F\u6210\u5B8C\u6574\u62A5\u544A\u2026",
      "status.fullDone": "\u5B8C\u6574\u62A5\u544A\u5B8C\u6210\u3002",
      "status.fullErr": "\u62A5\u544A\u9519\u8BEF\uFF1A{err}",
      "status.noContent": "\u6682\u65E0\u5185\u5BB9\u3002",
      "status.summaryErr": "\u6458\u8981\uFF1A{err}",
      "status.stopFirst": "\u751F\u6210\u5B8C\u6574\u62A5\u544A\u524D\u8BF7\u5148\u505C\u6B62\u5F55\u5236\u3002",
      "status.popoutErr": "\u65E0\u6CD5\u6253\u5F00\u5355\u72EC\u7A97\u53E3\uFF1A{err}",
      "pip.title": "\u60AC\u6D6E\u7F6E\u9876\uFF08PiP \u2014 \u59CB\u7EC8\u5728\u6700\u524D\uFF09",
      "pip.active": "\u5DF2\u5728\u60AC\u6D6E(PiP)\u7A97\u53E3\u663E\u793A\u3002\u5173\u95ED PiP \u53EF\u6062\u590D\u5230\u6B64\u5904\u3002",
      "status.pipUnsupported": "\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 Document Picture-in-Picture\u3002",
      "status.pipErr": "PiP \u9519\u8BEF\uFF1A{err}",
      "pip.return": "\u8FD4\u56DE\u539F\u7A97\u53E3",
      "status.micPermNeeded": '\u6B63\u5728\u65B0\u7A97\u53E3\u8BF7\u6C42\u9EA6\u514B\u98CE\u6743\u9650 \u2014 \u9009\u62E9"\u5141\u8BB8"\u540E\u8BF7\u91CD\u65B0\u70B9\u51FB\u5F00\u59CB\u3002',
      "status.micGranted": "\u2705 \u5DF2\u6388\u4E88\u9EA6\u514B\u98CE\u6743\u9650\u3002",
      "status.micPermHint": "\u{1F3A4} \u9EA6\u514B\u98CE\u672A\u6388\u6743 \u2014 \u70B9\u51FB\u5F00\u59CB\u4EE5\u6388\u4E88\u3002",
      "status.summaryApplied": "\u5DF2\u5E94\u7528\u8981\u6C42\u5E76\u91CD\u65B0\u6458\u8981\u3002",
      "status.noKeyShort": "\u7F3A\u5C11 API \u5BC6\u94A5\u3002",
      "status.geminiErr": "Gemini\uFF1A{err}"
    }
  };
  var _loc = "vi";
  function setLocale(code) {
    if (I18N[code]) _loc = code;
  }
  function currentLocale() {
    return _loc;
  }
  function t(key, vars) {
    const d = I18N[_loc] || I18N.en;
    let s = d[key] != null ? d[key] : I18N.en[key] != null ? I18N.en[key] : key;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }
  function applyI18n(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((e) => {
      e.textContent = t(e.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((e) => {
      e.title = t(e.getAttribute("data-i18n-title"));
    });
    root.querySelectorAll("[data-i18n-ph]").forEach((e) => {
      e.setAttribute("placeholder", t(e.getAttribute("data-i18n-ph")));
    });
  }

  // extension/app.js
  var DEFAULTS = {
    apiKey: "",
    langCode: "vi",
    transcribeMode: false,
    geminiVoice: DEFAULT_VOICE,
    geminiAudioOn: true,
    source: "mic",
    summaryExtra: "",
    uiLang: "vi",
    showOriginal: false
  };
  var S = { ...DEFAULTS };
  async function loadSettings() {
    const got = await chrome.storage.local.get(DEFAULTS);
    Object.assign(S, got);
  }
  function save(patch) {
    Object.assign(S, patch);
    chrome.storage.local.set(patch);
  }
  var $ = (id) => document.getElementById(id);
  var el = {
    settingsBtn: $("settings-btn"),
    popoutBtn: $("popout-btn"),
    pipBtn: $("pip-btn"),
    settings: $("settings"),
    langBtn: $("lang-btn"),
    langMenu: $("lang-menu"),
    apikey: $("apikey"),
    keyStatus: $("key-status"),
    source: $("source"),
    targetBtn: $("target-btn"),
    targetMenu: $("target-menu"),
    voice: $("voice"),
    start: $("start"),
    status: $("status"),
    list: $("list"),
    count: $("count"),
    autoscroll: $("autoscroll"),
    origBtn: $("orig-btn"),
    summaryToggle: $("summary-toggle"),
    export: $("export"),
    clear: $("clear"),
    summaryWrap: $("summary-wrap"),
    summary: $("summary"),
    sumSpin: $("sum-spin"),
    sumEdit: $("sum-edit"),
    sumEditBox: $("sum-edit-box"),
    summaryExtra: $("summary-extra"),
    sumExtraSave: $("sum-extra-save"),
    sumFull: $("sum-full"),
    sumCopy: $("sum-copy"),
    sumExport: $("sum-export"),
    vResizer: $("v-resizer"),
    dl: $("dl")
  };
  var langName = (c) => (I18N_LOCALES.find((l) => l.code === c) || {}).name || c;
  var _lastStatus = null;
  function st(key, vars, cls) {
    _lastStatus = { key, vars, cls };
    el.status.textContent = t(key, vars);
    el.status.className = "status" + (cls ? " " + cls : "");
  }
  var live = createLiveTranslator({
    getState: () => ({ apiKey: S.apiKey, langCode: S.langCode, transcribeMode: S.transcribeMode, geminiAudioOn: S.geminiAudioOn, geminiVoice: S.geminiVoice }),
    onCaption: addCaption,
    onAudio: playAudio,
    onClear: clearAudio,
    onStatus: ({ error }) => {
      if (error === "no-key") st("status.noKeyShort", null, "err");
      else if (error) st("status.geminiErr", { err: error }, "err");
    }
  });
  var summarizer = createSummarizer({
    getState: () => ({ apiKey: S.apiKey, targetLangLabel: LANG_LABELS[S.langCode] || "ti\u1EBFng Vi\u1EC7t", transcribeMode: S.transcribeMode, summaryExtra: S.summaryExtra })
  });
  var captions = [];
  var byId = /* @__PURE__ */ new Map();
  var rowById = /* @__PURE__ */ new Map();
  var autoScroll = true;
  function refreshCount() {
    el.count.textContent = t("count", { n: captions.length });
  }
  function addCaption(c) {
    let e = byId.get(c.id);
    if (!e) {
      e = { id: c.id, author: c.author, translated: c.translated, original: c.original, lines: c.lines, ts: c.ts, tsMs: c.tsMs, partial: c.isPartial };
      captions.push(e);
      byId.set(c.id, e);
    } else {
      e.translated = c.translated;
      e.original = c.original;
      e.lines = c.lines;
      e.author = c.author;
      e.partial = c.isPartial;
    }
    upsertRow(e);
    if (!c.isPartial && sumPanelOpen) summarizeTick();
  }
  function upsertRow(e) {
    let row = rowById.get(e.id);
    if (!row) {
      row = document.createElement("div");
      row.className = "entry";
      row.innerHTML = '<div class="entry-head"><span class="spacer"></span><span class="ts"></span></div><div class="entry-body"></div>';
      el.list.appendChild(row);
      rowById.set(e.id, row);
    }
    row.classList.toggle("partial", !!e.partial);
    row.querySelector(".ts").textContent = e.ts || "";
    const body = row.querySelector(".entry-body");
    const lines = e.lines && e.lines.length ? e.lines : [{ o: e.original || "", t: e.translated || "" }];
    body.innerHTML = "";
    for (const l of lines) {
      if (S.showOriginal && l.o) {
        const d = document.createElement("div");
        d.className = "entry-orig";
        d.textContent = l.o;
        body.appendChild(d);
      }
      if (l.t) {
        const d = document.createElement("div");
        d.className = "entry-text";
        d.textContent = l.t;
        body.appendChild(d);
      }
    }
    refreshCount();
    if (autoScroll) el.list.scrollTop = el.list.scrollHeight;
  }
  function reRenderAll() {
    for (const e of captions) upsertRow(e);
  }
  function clearList() {
    captions.length = 0;
    byId.clear();
    rowById.clear();
    el.list.innerHTML = "";
    refreshCount();
    summaryMd = "";
    sumPrevCount = 0;
    sumLastTime = 0;
    renderSummary();
  }
  var _gemCtx = null;
  var _gemPlayhead = 0;
  var _gemNodes = [];
  var _GEM_LEAD = 0.4;
  var _GEM_SOFT_LEAD = 1;
  var _GEM_HARD_LEAD = 2.5;
  var _GEM_START_LEAD = 0.2;
  var _gemSpeed = 1;
  var _gemLastEnd = 0;
  function ensureGemCtx() {
    if (!_gemCtx || _gemCtx.state === "closed") {
      _gemCtx = new (window.AudioContext || window.webkitAudioContext)();
      _gemPlayhead = 0;
      _gemNodes = [];
    }
    if (_gemCtx.state === "suspended") _gemCtx.resume().catch(() => {
    });
    return _gemCtx;
  }
  function clearAudio() {
    for (const n of _gemNodes) {
      try {
        n.onended = null;
        n.stop();
      } catch (e) {
      }
    }
    _gemNodes = [];
    _gemPlayhead = 0;
    _gemSpeed = 1;
    _gemLastEnd = 0;
  }
  function playAudio({ b64, sampleRate }) {
    try {
      if (!S.geminiAudioOn || !b64) return;
      const bin = atob(b64);
      const n = bin.length >> 1;
      if (!n) return;
      const f32 = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = bin.charCodeAt(i * 2 + 1) << 8 | bin.charCodeAt(i * 2);
        if (s >= 32768) s -= 65536;
        f32[i] = s / 32768;
      }
      const ctx = ensureGemCtx();
      if (_gemPlayhead - ctx.currentTime > _GEM_HARD_LEAD) {
        const now = ctx.currentTime;
        let resumeAt = now + _GEM_LEAD;
        for (const nd of _gemNodes.slice()) {
          if ((nd._s || 0) > now + 5e-3) {
            try {
              nd.onended = null;
              nd.stop();
            } catch (e) {
            }
            const i = _gemNodes.indexOf(nd);
            if (i >= 0) _gemNodes.splice(i, 1);
          } else if ((nd._e || 0) > resumeAt) resumeAt = nd._e;
        }
        _gemPlayhead = resumeAt;
        _gemSpeed = 1;
      }
      const lead = _gemPlayhead - ctx.currentTime;
      if (lead > _GEM_SOFT_LEAD) _gemSpeed = 1.06;
      else if (lead < _GEM_SOFT_LEAD * 0.5) _gemSpeed = 1;
      const spd = _gemSpeed;
      const buf = ctx.createBuffer(1, n, sampleRate || 24e3);
      buf.getChannelData(0).set(f32);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = spd;
      node.connect(ctx.destination);
      if (_gemPlayhead < ctx.currentTime + 0.02) {
        const idle = ctx.currentTime - _gemLastEnd;
        _gemPlayhead = ctx.currentTime + (idle > 0.35 ? _GEM_START_LEAD : _GEM_LEAD);
      }
      const startAt = _gemPlayhead;
      node.start(startAt);
      _gemPlayhead = startAt + buf.duration / spd;
      node._s = startAt;
      node._e = _gemPlayhead;
      _gemLastEnd = _gemPlayhead;
      _gemNodes.push(node);
      node.onended = () => {
        const i = _gemNodes.indexOf(node);
        if (i >= 0) _gemNodes.splice(i, 1);
      };
    } catch (e) {
      console.warn("[tts] play l\u1ED7i:", e && e.message);
    }
  }
  var recActive = false;
  var audioCtx = null;
  var srcNode = null;
  var procNode = null;
  var zeroGain = null;
  var rawStream = null;
  var watchdog = null;
  var lastTs = 0;
  var MIC_GATE_RMS = 4e-3;
  var MIC_GATE_HANG_MS = 700;
  var micVoiceUntil = 0;
  async function startCapture() {
    let stream;
    if (S.source === "mic") {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
          video: false
        });
      } catch (e) {
        if (e && (e.name === "NotAllowedError" || e.name === "NotFoundError" || e.name === "SecurityError")) {
          _autoStartAfterGrant = true;
          try {
            const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("mic-perm.html"), active: true });
            _micPermTabId = tab && tab.id;
          } catch (_) {
            try {
              await chrome.windows.create({ url: chrome.runtime.getURL("mic-perm.html"), type: "normal", width: 520, height: 420, focused: true });
            } catch (__) {
            }
          }
          const pe = new Error("mic-perm");
          pe.name = "MicPermNeeded";
          throw pe;
        }
        throw e;
      }
    } else {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Chrome 141+ (Win/macOS): gỡ tiếng do CHÍNH side panel này phát (TTS) khỏi system audio capture
          // → chống TTS vọng lại ở TẦNG AUDIO (trước khi tới Gemini). No-op nếu nguồn không có system audio
          // hoặc trình duyệt cũ chưa hỗ trợ (constraint "ideal" nên bị bỏ qua, KHÔNG ném lỗi).
          restrictOwnAudio: true
        },
        systemAudio: "include",
        // hiện rõ tuỳ chọn "chia sẻ âm thanh hệ thống" trong picker
        selfBrowserSurface: "exclude"
        // ẩn chính tab/panel của extension khỏi danh sách chọn
      });
      stream.getVideoTracks().forEach((t2) => t2.stop());
    }
    rawStream = stream;
    const tracks = stream.getAudioTracks();
    if (!tracks.length) throw new Error("ngu\u1ED3n kh\xF4ng c\xF3 audio \u2014 ch\u1ECDn 'Tab' ho\u1EB7c tick 'Chia s\u1EBB \xE2m thanh' khi ch\u1ECDn To\xE0n m\xE0n h\xECnh (c\u1EEDa s\u1ED5 app th\u01B0\u1EDDng kh\xF4ng c\xF3 audio)");
    if (S.source !== "mic" && tracks[0] && tracks[0].getSettings) {
      const aset = tracks[0].getSettings();
      console.log("[capture] restrictOwnAudio =", aset.restrictOwnAudio, "\u2014 true = \u0111ang g\u1EE1 TTS c\u1EE7a panel kh\u1ECFi audio thu; undefined = tr\xECnh duy\u1EC7t ch\u01B0a h\u1ED7 tr\u1EE3");
    }
    recActive = true;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16e3 });
    if (audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
      } catch (e) {
      }
    }
    audioCtx.onstatechange = () => {
      if (recActive && audioCtx && audioCtx.state !== "running") audioCtx.resume().catch(() => {
      });
    };
    srcNode = audioCtx.createMediaStreamSource(new MediaStream(tracks));
    procNode = audioCtx.createScriptProcessor(4096, 1, 1);
    zeroGain = audioCtx.createGain();
    zeroGain.gain.value = 0;
    procNode.onaudioprocess = (e) => {
      if (!recActive) return;
      lastTs = Date.now();
      const ch = e.inputBuffer.getChannelData(0);
      if (S.source === "mic") {
        let sum = 0;
        for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        if (Math.sqrt(sum / ch.length) >= MIC_GATE_RMS) micVoiceUntil = lastTs + MIC_GATE_HANG_MS;
        if (lastTs > micVoiceUntil) return;
      }
      live.pushAudio(new Float32Array(ch));
    };
    srcNode.connect(procNode);
    procNode.connect(zeroGain);
    zeroGain.connect(audioCtx.destination);
    lastTs = Date.now();
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (recActive && audioCtx && Date.now() - lastTs > 3e3) audioCtx.resume().catch(() => {
      });
    }, 2e3);
    tracks[0].addEventListener("ended", () => {
      if (recActive) stop();
    });
    if (_isPopup && S.source === "mic" && "mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", () => {
          if (!_inPip) {
            _pipAuto = true;
            openPip();
          }
        });
        navigator.mediaSession.playbackState = "playing";
      } catch (_) {
      }
    }
  }
  function stopCapture() {
    recActive = false;
    clearInterval(watchdog);
    watchdog = null;
    try {
      if (procNode) {
        procNode.onaudioprocess = null;
        procNode.disconnect();
      }
    } catch (e) {
    }
    try {
      if (srcNode) srcNode.disconnect();
    } catch (e) {
    }
    try {
      if (zeroGain) zeroGain.disconnect();
    } catch (e) {
    }
    try {
      if (audioCtx) audioCtx.close();
    } catch (e) {
    }
    procNode = srcNode = zeroGain = audioCtx = null;
    rawStream?.getTracks().forEach((t2) => t2.stop());
    rawStream = null;
    try {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
        navigator.mediaSession.playbackState = "none";
      }
    } catch (_) {
    }
  }
  var running = false;
  var _micPermTabId = null;
  var _autoStartAfterGrant = false;
  function refreshStartBtn() {
    el.start.textContent = t(running ? "btn.stop" : "btn.start");
    el.start.classList.toggle("on", running);
  }
  async function start() {
    if (running) return;
    if (!S.apiKey || !S.apiKey.trim()) {
      st("status.needKey", null, "err");
      el.settings.classList.remove("hidden");
      return;
    }
    try {
      ensureGemCtx();
      live.start();
      await startCapture();
      running = true;
      refreshStartBtn();
      refreshSpin();
      st(S.source === "mic" ? "status.listeningMic" : "status.listeningAudio", null, "run");
    } catch (e) {
      console.error(e);
      live.stop();
      stopCapture();
      if (e && e.name === "MicPermNeeded") st("status.micPermNeeded", null, "err");
      else if (e && e.name === "NotAllowedError") st("status.canceled");
      else st("status.captureErr", { err: e.message || e.name || e }, "err");
    }
  }
  function stop() {
    if (!running) return;
    running = false;
    live.stop();
    stopCapture();
    clearAudio();
    refreshStartBtn();
    refreshSpin();
    st("status.stopped");
  }
  function closeSelf() {
    try {
      chrome.tabs.getCurrent((tab) => {
        if (tab && tab.id != null) {
          try {
            chrome.tabs.remove(tab.id);
          } catch (_) {
            window.close();
          }
        } else window.close();
      });
    } catch (_) {
      window.close();
    }
  }
  async function _micPermState() {
    try {
      return (await navigator.permissions.query({ name: "microphone" })).state;
    } catch (_) {
      return "unknown";
    }
  }
  async function ensureMicPermission() {
    const s = await _micPermState();
    if (s === "granted" || s === "unknown") return;
    _autoStartAfterGrant = false;
    if (_isPopup) {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
        ms.getTracks().forEach((t2) => t2.stop());
        st("status.micGranted", null, "run");
      } catch (_) {
        st("status.micPermHint", null, "err");
      }
    } else {
      try {
        const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("mic-perm.html"), active: true });
        _micPermTabId = tab && tab.id;
        st("status.micPermNeeded", null, "err");
      } catch (_) {
      }
    }
  }
  var summaryMd = "";
  var sumPrevCount = 0;
  var sumBusy = false;
  var sumTimer = null;
  var sumPanelOpen = false;
  var sumLastTime = 0;
  var SUM_MIN_NEW = 24;
  var SUM_POLL_MS = 12e3;
  var SUM_MAX_CAPS_PER_CALL = 25;
  var SUM_MIN_FIRST = 8;
  var SUM_MIN_FIRST_CHARS = 400;
  var finalized = () => captions.filter((c) => !c.partial);
  async function summarizeTick() {
    if (sumBusy) return;
    const caps = finalized();
    const newCount = caps.length - sumPrevCount;
    const firstChars = caps.reduce((n, c) => n + (c.translated || c.original || "").length, 0);
    const firstReady = sumLastTime === 0 && caps.length >= SUM_MIN_FIRST && firstChars >= SUM_MIN_FIRST_CHARS;
    if (!(newCount >= SUM_MIN_NEW || firstReady)) return;
    sumBusy = true;
    refreshSpin();
    let newCaps = caps.slice(sumPrevCount);
    if (newCaps.length > SUM_MAX_CAPS_PER_CALL) newCaps = newCaps.slice(newCaps.length - SUM_MAX_CAPS_PER_CALL);
    try {
      const res = await summarizer.summarize({ prevSummary: summaryMd, captions: newCaps });
      if (res && res.ok) {
        summaryMd = res.markdown;
        renderSummary();
        sumPrevCount = caps.length;
        sumLastTime = Date.now();
      } else if (res && res.error !== "empty") st("status.summaryErr", { err: res.error }, "err");
    } catch (e) {
      st("status.summaryErr", { err: e.message }, "err");
    } finally {
      sumBusy = false;
      refreshSpin();
    }
  }
  function refreshSpin() {
    el.sumSpin.classList.toggle("hidden", !(running && sumPanelOpen || sumBusy));
  }
  async function regenerateSummary() {
    if (sumBusy) return;
    const caps = finalized();
    if (!caps.length) return;
    sumBusy = true;
    refreshSpin();
    let newCaps = caps;
    if (newCaps.length > SUM_MAX_CAPS_PER_CALL) newCaps = newCaps.slice(newCaps.length - SUM_MAX_CAPS_PER_CALL);
    try {
      const res = await summarizer.summarize({ prevSummary: "", captions: newCaps });
      if (res && res.ok) {
        summaryMd = res.markdown;
        renderSummary();
        sumPrevCount = caps.length;
        sumLastTime = Date.now();
      } else if (res && res.error !== "empty") st("status.summaryErr", { err: res.error }, "err");
    } catch (e) {
      st("status.summaryErr", { err: e.message }, "err");
    } finally {
      sumBusy = false;
      refreshSpin();
    }
  }
  function openSummary() {
    sumPanelOpen = true;
    el.summaryWrap.classList.remove("hidden");
    el.vResizer.classList.remove("hidden");
    el.summaryToggle.classList.add("active");
    if (!el.summaryWrap.style.height) el.summaryWrap.style.height = Math.round(window.innerHeight * 0.35) + "px";
    refreshSpin();
    summarizeTick();
    clearInterval(sumTimer);
    sumTimer = setInterval(summarizeTick, SUM_POLL_MS);
  }
  function closeSummary() {
    sumPanelOpen = false;
    el.summaryWrap.classList.add("hidden");
    el.vResizer.classList.add("hidden");
    el.summaryToggle.classList.remove("active");
    el.sumEditBox.classList.add("hidden");
    refreshSpin();
    clearInterval(sumTimer);
    sumTimer = null;
  }
  function renderSummary() {
    el.summary.innerHTML = summaryMd ? md2html(summaryMd) : `<em class="muted">${t("summary.empty")}</em>`;
  }
  function md2html(md) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`(.+?)`/g, "<code>$1</code>");
    const lines = String(md).replace(/\r/g, "").split("\n");
    const out = [];
    let i = 0;
    const isSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
    while (i < lines.length) {
      const ln = lines[i];
      if (/^\s*#{1,6}\s+/.test(ln)) {
        const m = ln.match(/^\s*(#{1,6})\s+(.*)$/);
        const lv = Math.min(m[1].length, 3);
        out.push(`<h${lv}>${inline(m[2].replace(/\*\*/g, ""))}</h${lv}>`);
        i++;
        continue;
      }
      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(ln)) {
        const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
        const stack = [];
        while (i < lines.length) {
          const m = lines[i].match(listRe);
          if (!m) break;
          const indent = m[1].replace(/\t/g, "  ").length;
          const tag = /^\d/.test(m[2]) ? "ol" : "ul";
          const li = "<li>" + inline(m[3]);
          if (!stack.length || indent > stack[stack.length - 1].indent) {
            out.push("<" + tag + ">");
            stack.push({ indent, tag });
            out.push(li);
          } else if (indent === stack[stack.length - 1].indent) {
            out.push("</li>");
            out.push(li);
          } else {
            while (stack.length > 1 && indent < stack[stack.length - 1].indent) out.push("</li></" + stack.pop().tag + ">");
            out.push("</li>");
            out.push(li);
          }
          i++;
        }
        while (stack.length) out.push("</li></" + stack.pop().tag + ">");
        continue;
      }
      if (ln.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
        const cells = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
        const head = cells(ln);
        i += 2;
        out.push("<table><thead><tr>" + head.map((h) => "<th>" + inline(h) + "</th>").join("") + "</tr></thead><tbody>");
        while (i < lines.length && lines[i].includes("|")) {
          out.push("<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>");
          i++;
        }
        out.push("</tbody></table>");
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) {
        out.push("<hr>");
        i++;
        continue;
      }
      if (ln.trim() === "") {
        i++;
        continue;
      }
      out.push("<p>" + inline(ln) + "</p>");
      i++;
    }
    return out.join("");
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    el.dl.href = url;
    el.dl.download = name;
    el.dl.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportTranscript() {
    if (!captions.length) {
      st("status.noContent");
      return;
    }
    const lines = captions.map((c) => {
      const head = `[${c.ts || ""}] ${c.author || "STT"}:`;
      if (c.original && c.original.trim()) return `${head}
  \u2022 ${c.original}
  \u2192 ${c.translated || ""}`;
      return `${head} ${c.translated || ""}`;
    });
    download(`transcript-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.txt`, lines.join("\n"));
  }
  function buildVoiceSelect() {
    el.voice.innerHTML = "";
    const off = document.createElement("option");
    off.value = "__off__";
    off.textContent = t("voice.off");
    el.voice.appendChild(off);
    for (const v of GEM_VOICES) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = "\u{1F50A} " + v;
      el.voice.appendChild(o);
    }
    el.voice.value = S.geminiAudioOn ? S.geminiVoice : "__off__";
  }
  function buildTargetButton() {
    el.targetBtn.innerHTML = S.transcribeMode ? `<span>${t("lang.transcribe")}</span>` : `<span class="flag">${flag(S.langCode)}</span><span>${langName(S.langCode)}</span>`;
  }
  function buildLangMenu() {
    el.langMenu.innerHTML = "";
    for (const L of I18N_LOCALES) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="flag">${flag(L.code)}</span><span>${L.name}</span>`;
      if (L.code === currentLocale()) b.classList.add("sel");
      b.addEventListener("click", () => {
        applyLocale(L.code);
        closeMenus();
      });
      el.langMenu.appendChild(b);
    }
  }
  function buildTargetMenu() {
    el.targetMenu.innerHTML = "";
    for (const L of I18N_LOCALES) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="flag">${flag(L.code)}</span><span>${L.name}</span>`;
      if (!S.transcribeMode && S.langCode === L.code) b.classList.add("sel");
      b.addEventListener("click", () => {
        pickTarget(L.code, false);
        closeMenus();
      });
      el.targetMenu.appendChild(b);
    }
    const tb = document.createElement("button");
    tb.type = "button";
    tb.innerHTML = `<span>${t("lang.transcribe")}</span>`;
    if (S.transcribeMode) tb.classList.add("sel");
    tb.addEventListener("click", () => {
      pickTarget(null, true);
      closeMenus();
    });
    el.targetMenu.appendChild(tb);
  }
  function pickTarget(code, transcribe) {
    if (transcribe) {
      save({ transcribeMode: true });
      live.onTranscribeModeChanged();
    } else {
      const wasT = S.transcribeMode;
      save({ langCode: code, transcribeMode: false });
      wasT ? live.onTranscribeModeChanged() : live.onTargetLangChanged();
    }
    el.voice.disabled = S.transcribeMode;
    buildTargetButton();
  }
  function closeMenus() {
    el.langMenu.classList.add("hidden");
    el.targetMenu.classList.add("hidden");
  }
  function applyLocale(code) {
    setLocale(code);
    save({ uiLang: code });
    applyI18n(document);
    buildVoiceSelect();
    buildTargetButton();
    refreshStartBtn();
    refreshCount();
    renderSummary();
    el.langBtn.innerHTML = `<span class="flag">${flag(code)}</span>`;
    if (_lastStatus) st(_lastStatus.key, _lastStatus.vars, _lastStatus.cls);
  }
  function initResizer() {
    let startY = 0, startH = 0, dragging = false;
    el.vResizer.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = e.clientY;
      startH = el.summaryWrap.offsetHeight;
      try {
        el.vResizer.setPointerCapture(e.pointerId);
      } catch (_) {
      }
      e.preventDefault();
    });
    el.vResizer.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const max = Math.round(window.innerHeight * 0.78);
      el.summaryWrap.style.height = Math.max(110, Math.min(max, startH - dy)) + "px";
    });
    const end = (e) => {
      dragging = false;
      try {
        el.vResizer.releasePointerCapture(e.pointerId);
      } catch (_) {
      }
    };
    el.vResizer.addEventListener("pointerup", end);
    el.vResizer.addEventListener("pointercancel", end);
  }
  var keyTimer = null;
  async function checkKey() {
    const k = el.apikey.value.trim();
    if (!k) {
      el.keyStatus.textContent = "";
      el.keyStatus.className = "key-status";
      return;
    }
    el.keyStatus.textContent = t("status.checking");
    el.keyStatus.className = "key-status";
    const r = await validateKey(k);
    if (r.ok) {
      el.keyStatus.textContent = t("status.keyOk");
      el.keyStatus.className = "key-status ok";
    } else {
      el.keyStatus.textContent = r.error === "invalid" ? t("status.keyBad") : "\u2715 " + r.error;
      el.keyStatus.className = "key-status err";
    }
  }
  var _pipHolder = null;
  var _inPip = false;
  var _myWindowId = null;
  var _pipAuto = false;
  var _autoReturning = false;
  var _isPopup = new URLSearchParams(location.search).get("popup") === "1";
  var _prevTabId = (() => {
    const v = new URLSearchParams(location.search).get("prev");
    return v != null ? parseInt(v, 10) : null;
  })();
  function _setPipReturnMode(on) {
    el.pipBtn.textContent = on ? "\u{1F519}" : "\u{1F4CC}";
    el.pipBtn.title = t(on ? "pip.return" : "pip.title");
  }
  function returnFromPip() {
    if (_myWindowId != null) {
      try {
        chrome.sidePanel.open({ windowId: _myWindowId });
      } catch (_) {
      }
    }
    const w = window.documentPictureInPicture && window.documentPictureInPicture.window;
    if (w) w.close();
  }
  async function openPip() {
    if (!("documentPictureInPicture" in window)) {
      st("status.pipUnsupported", null, "err");
      return;
    }
    try {
      if (window.documentPictureInPicture.window) {
        window.documentPictureInPicture.window.focus();
        return;
      }
      const pip = await window.documentPictureInPicture.requestWindow({ width: 460, height: 820 });
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const css = Array.from(sheet.cssRules).map((r) => r.cssText).join("");
          const s = pip.document.createElement("style");
          s.textContent = css;
          pip.document.head.appendChild(s);
        } catch (_) {
          if (sheet.href) {
            const l = pip.document.createElement("link");
            l.rel = "stylesheet";
            l.href = sheet.href;
            pip.document.head.appendChild(l);
          }
        }
      }
      const moved = [];
      while (document.body.firstChild) {
        const n = document.body.firstChild;
        moved.push(n);
        pip.document.body.appendChild(n);
      }
      const prevPop = el.popoutBtn.style.display;
      el.popoutBtn.style.display = "none";
      _inPip = true;
      _setPipReturnMode(true);
      _pipHolder = document.createElement("div");
      _pipHolder.className = "pip-holder";
      _pipHolder.textContent = t("pip.active");
      document.body.appendChild(_pipHolder);
      if (!_pipAuto && _prevTabId != null) {
        try {
          chrome.tabs.update(_prevTabId, { active: true });
        } catch (_) {
        }
      }
      pip.addEventListener("pagehide", () => {
        if (_pipHolder) {
          _pipHolder.remove();
          _pipHolder = null;
        }
        if (_autoReturning) {
          for (const n of moved) document.body.appendChild(n);
          el.popoutBtn.style.display = prevPop;
          _inPip = false;
          _pipAuto = false;
          _autoReturning = false;
          _setPipReturnMode(false);
        } else {
          try {
            stop();
          } catch (_) {
          }
          closeSelf();
        }
      });
    } catch (e) {
      st("status.pipErr", { err: e && e.message }, "err");
    }
  }
  function softReturnFromPip() {
    _autoReturning = true;
    const w = window.documentPictureInPicture && window.documentPictureInPicture.window;
    if (w) w.close();
    else _autoReturning = false;
  }
  function wire() {
    el.settingsBtn.addEventListener("click", () => el.settings.classList.toggle("hidden"));
    el.pipBtn.addEventListener("click", () => {
      if (_inPip) returnFromPip();
      else {
        _pipAuto = false;
        openPip();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && _inPip && _pipAuto) softReturnFromPip();
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "mic-granted") {
        if (_micPermTabId != null) {
          try {
            chrome.tabs.remove(_micPermTabId);
          } catch (_) {
          }
          _micPermTabId = null;
        }
        if (_autoStartAfterGrant && !running && S.source === "mic") start();
        else if (!running) st("status.micGranted", null, "run");
        _autoStartAfterGrant = false;
      }
    });
    el.popoutBtn.addEventListener("click", async () => {
      const page = location.pathname.split("/").pop() || "sidepanel.html";
      try {
        if (running) stop();
        let prev = "";
        try {
          const [act] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (act && act.id != null) prev = "&prev=" + act.id;
        } catch (_) {
        }
        await chrome.tabs.create({ url: chrome.runtime.getURL(page + "?popup=1" + prev), active: true });
        window.close();
      } catch (e) {
        st("status.popoutErr", { err: e && e.message }, "err");
      }
    });
    el.langBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const show = el.langMenu.classList.contains("hidden");
      closeMenus();
      if (show) {
        buildLangMenu();
        el.langMenu.classList.remove("hidden");
      }
    });
    el.targetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const show = el.targetMenu.classList.contains("hidden");
      closeMenus();
      if (show) {
        buildTargetMenu();
        el.targetMenu.classList.remove("hidden");
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dd")) closeMenus();
    });
    el.apikey.addEventListener("input", () => {
      save({ apiKey: el.apikey.value.trim() });
      clearTimeout(keyTimer);
      keyTimer = setTimeout(checkKey, 600);
    });
    el.source.addEventListener("change", () => {
      save({ source: el.source.value });
      if (el.source.value === "mic") ensureMicPermission();
    });
    el.voice.addEventListener("change", () => {
      const v = el.voice.value;
      if (v === "__off__") {
        save({ geminiAudioOn: false });
        live.setAudioOn(false);
      } else {
        const changed = v !== S.geminiVoice;
        save({ geminiAudioOn: true, geminiVoice: v });
        live.setAudioOn(true);
        if (changed && running) live.onVoiceChanged();
      }
    });
    el.start.addEventListener("click", () => running ? stop() : start());
    el.clear.addEventListener("click", clearList);
    el.export.addEventListener("click", exportTranscript);
    el.origBtn.addEventListener("click", () => {
      save({ showOriginal: !S.showOriginal });
      el.origBtn.classList.toggle("active", S.showOriginal);
      reRenderAll();
    });
    el.autoscroll.addEventListener("click", () => {
      autoScroll = !autoScroll;
      el.autoscroll.classList.toggle("active", autoScroll);
      if (autoScroll) el.list.scrollTop = el.list.scrollHeight;
    });
    el.list.addEventListener("scroll", () => {
      const near = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 40;
      autoScroll = near;
      el.autoscroll.classList.toggle("active", near);
    });
    el.summaryToggle.addEventListener("click", () => sumPanelOpen ? closeSummary() : openSummary());
    el.sumCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(summaryMd || "");
        st("status.copied");
      } catch (e) {
      }
    });
    el.sumExport.addEventListener("click", () => {
      if (summaryMd) download(`summary-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`, summaryMd, "text/markdown");
    });
    el.sumFull.addEventListener("click", async () => {
      if (running) {
        st("status.stopFirst");
        return;
      }
      const caps = finalized();
      if (!caps.length) {
        st("status.noContent");
        return;
      }
      st("status.makingFull");
      sumBusy = true;
      refreshSpin();
      const r = await summarizer.summarizeFull(caps);
      sumBusy = false;
      refreshSpin();
      if (r && r.ok) {
        summaryMd = r.markdown;
        renderSummary();
        el.summaryWrap.classList.remove("hidden");
        st("status.fullDone");
      } else st("status.fullErr", { err: r && r.error }, "err");
    });
    el.sumEdit.addEventListener("click", () => {
      const show = el.sumEditBox.classList.contains("hidden");
      el.sumEditBox.classList.toggle("hidden");
      if (show) {
        el.summaryExtra.value = S.summaryExtra || "";
        el.summaryExtra.focus();
      }
    });
    el.sumExtraSave.addEventListener("click", async () => {
      save({ summaryExtra: el.summaryExtra.value.trim() });
      el.sumEditBox.classList.add("hidden");
      await regenerateSummary();
    });
  }
  (async function init() {
    await loadSettings();
    setLocale(S.uiLang || "vi");
    if (_isPopup) {
      el.popoutBtn.style.display = "none";
      try {
        chrome.tabs.getCurrent((tab) => {
          if (tab) _myWindowId = tab.windowId;
        });
      } catch (_) {
      }
    } else {
      el.pipBtn.style.display = "none";
    }
    if (S.source !== "mic" && S.source !== "screen") save({ source: "screen" });
    el.apikey.value = S.apiKey;
    el.source.value = S.source;
    el.origBtn.classList.toggle("active", S.showOriginal);
    buildVoiceSelect();
    el.voice.disabled = S.transcribeMode;
    buildTargetButton();
    el.langBtn.innerHTML = `<span class="flag">${flag(S.uiLang)}</span>`;
    applyI18n(document);
    refreshStartBtn();
    refreshCount();
    renderSummary();
    initResizer();
    wire();
    if (S.apiKey) checkKey();
    st(S.apiKey ? "status.ready" : "status.readyNoKey");
    if (S.source === "mic") ensureMicPermission();
  })();
})();
