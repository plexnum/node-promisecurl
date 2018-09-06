/**
 * Created by horat1us on 11.10.16.
 */
"use strict";
const Curl = require('node-libcurl').Curl;
const {CookieJar, Cookie} = require("tough-cookie");

module.exports = {

    PromiseCurl: class PromiseCurl {
        constructor({
                        jar = null,
                        headers = [],
                        timeout = 5,
                        curlOptions:options = {},
                        referer = "google.com",
                        proxy = false
                    } = {}) {

            if(!jar) {
                jar = new CookieJar(null, {
                    rejectPublicSuffixes: false,
                    looseMode: true
                });
            }

            this.options = options;
            this.timeout = timeout;
            this.referer = referer;
            this.headers = Array.isArray(headers) ? headers : [headers];
            this.jar = jar;
            if (proxy !== false && !(proxy instanceof module.exports.Proxy)) {
                throw new module.exports.PromiseCurlError(6);
            }
            this.proxy = proxy;
        }


        request({
                    method,
                    headers = [],
                    referer = this.referer,
                    jar = this.jar,
                    data: postdata = false,
                    url,
                    followLocation = true,
                    timeout = this.timeout,
                    currentOptions = {}
                }) {

            if (typeof(method) !== 'string') {
                throw new module.exports.PromiseCurlError(3);
            }
            method = method.toUpperCase();
            if (!url) {
                throw new module.exports.PromiseCurlError(4);
            }

            return new Promise(async (resolve, reject) => {
                const curl = new Curl();
                let httpHeader = this.headers;
                if (Array.isArray(headers)) {
                    httpHeader = httpHeader.concat(headers);
                }
                httpHeader.filter(header => header.substr(0, 6) !== 'Cookie');

                let httpHeaderCookieValue = await new Promise((resolve, reject) => {

                    jar.getCookieString(url, (err, cookieHeaders) => {

                        console.log(cookieHeaders);

                        if(err) {
                            reject(err);
                        } else {
                            resolve(cookieHeaders);
                        }

                    })
                });


                if(httpHeaderCookieValue) {
                    httpHeader.push('Cookie: '+httpHeaderCookieValue);
                }

                Object.assign(currentOptions, {
                    referer, timeout, followLocation, url, httpHeader,
                });
                if (method == 'POST' && postdata !== false) {
                    if (Array.isArray(postdata)) {
                        currentOptions.httppost = postdata;
                    } else if (typeof(postdata) === 'object') {
                        currentOptions.postfields =
                            require('querystring').encode(postdata === false ? {} : postdata);
                    } else if (typeof(postdata) === 'string') {
                        currentOptions.postfields = postdata;
                    } else {
                        throw new module.exports.PromiseCurlError(5);
                    }
                }
                if (this.proxy) {
                    currentOptions.proxy = this.proxy.toString();
                }

                const curlOptions = PromiseCurl.initOptions(currentOptions, this.options);

                curlOptions.forEach((nameValue) => curl.setOpt(...nameValue));

                const responseHeaders = [], headersObject = {};
                const cookiesPromises = [];

                curl.perform()
                    .on('header', (header) => {

                        const responseHeader = header.toString().replace(/[\n\r]{1,2}/, '');
                        responseHeaders.push(responseHeader);
                        header = responseHeader.split(/:\s(.+)/);

                        if(header[0] && header[0].toUpperCase() === 'LOCATION') {
                            url = header[1].trim();
                        }

                        if(header[0] && header[0].toUpperCase() === 'SET-COOKIE') {

                            cookiesPromises.push(new Promise((resolve, reject) => {

                                let cookie = Cookie.parse(header[1], {loose: true});

                                this.jar.setCookie(Cookie.parse(header[1], {loose: true}), url, {
                                    ignoreError: false
                                }, (err, cookie) => {

                                    if(err) {
                                        reject(err);
                                    } else {
                                        resolve();
                                    }
                                })
                            }));
                        }

                    })
                    .on('end', (statusCode, body, argHeader) => {

                        responseHeaders
                            .filter(header => header.length > 0)
                            .filter(header => header.split(':').length >= 2)
                            .map((header) => header.match(/([^:]*):(.*)/))
                            .forEach(([,name,value]) => headersObject[name.trim()] = value.trim());

                        Promise.all(cookiesPromises).then(() => {

                            resolve({
                                statusCode,
                                body,
                                jar: this.jar,
                                headers: headersObject,
                            });

                        }, (error) => {
                            console.log(error);
                            reject(error);
                        });

                    })
                    .on('error', error => {
                        console.log(error);
                        reject(error);
                        curl.close.bind(curl)();
                    });
            });
        }

        setOpt(name, value) {
            this.options[name] = value;
        }

        get(options) {
            return this.request(Object.assign({method: "GET",}, options));
        }

        post(options) {
            return this.request(Object.assign({method: "POST",}, options));
        }

        static initOptions(userOptions = {}, mainOptions = {}) {
            const options = [],
                generateOptions = (opts) => {
                    for (let option in opts) {
                        if (!opts.hasOwnProperty(option)) {
                            continue;
                        }
                        if (!Curl.option.hasOwnProperty(option.toUpperCase())) {
                            throw new module.exports.PromiseCurlError(`Unknown Curl Option: ${option}`);
                        }
                        options.push([option.toUpperCase(), opts[option]]);
                    }
                };
            [mainOptions, userOptions].forEach(generateOptions);
            return options;
        }
    },
    Proxy: class Proxy {
        constructor({
                        type = 'http',
                        host, port,
                        username = false, password = false
                    }) {
            if (!host || !port) {
                throw new module.exports.PromiseCurlError(2);
            }

            this.auth = (password === false || username === false) ? false : {password, username};

            this.type = Proxy.initProxyType(type);
            this.shortType = type;
            this.host = host;
            this.port = port;
        }

        toString() {
            const auth = this.auth ? `${this.auth.username}:${this.auth.password}@` : '';
            return `${this.shortType}://${auth}${this.host}:${this.port}`;
        }

        /**
         * @param {String} proxyType
         */
        static initProxyType(proxyType) {
            const proxyTypes = require('./proxytypes.js');

            if (proxyTypes.hasOwnProperty(proxyType)) {
                return proxyTypes[proxyType];
            }

            throw new module.exports.PromiseCurlError(1);
        }


    },
    PromiseCurlError: class PromiseCurlError extends Error {
        constructor(errorCode) {
            if (typeof(errorCode) === 'string') {
                return super(errorCode);
            }
            const errors = require('./errors.js');

            super(errors.hasOwnProperty(errorCode) ? errors[errorCode] : `Unknown error: ${errorCode}`);
        }
    }
};