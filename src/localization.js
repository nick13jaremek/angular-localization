angular.module('ngLocalize')
    .service('locale', function ($injector, $http, $q, $log, $rootScope, $window, localeConf, localeEvents, localeSupported, localeFallbacks) {
        var TOKEN_REGEX = new RegExp('^[\\w\\.-]+\\.[\\w\\s\\.-]+\\w(:.*)?$'),

            $html = angular.element(document.body).parent(),
            currentLocale,
            deferrences,
            bundles,
            cookieStore;

        if (localeConf.persistSelection && $injector.has('$cookieStore')) {
            cookieStore = $injector.get('$cookieStore');
        }

        function isToken(str) {
            return (str && str.length && TOKEN_REGEX.test(str));
        }

        function getPath(tok) {
            var path = tok ? tok.split('.') : '',
                result = '';

            if (path.length > 1) {
                result = path.slice(0, -1).join('.');
            }

            return result;
        }

        function getKey(tok) {
            var path = tok ? tok.split('.') : [],
                result = '';

            if (path.length) {
                result = path[path.length - 1];
            }

            return result;
        }

        function getBundle(tok) {
            var result = null,
                path = tok ? tok.split('.') : [],
                i;

            if (path.length > 1) {
                result = bundles;

                for (i = 0; i < path.length - 1; i++) {
                    if (result[path[i]]) {
                        result = result[path[i]];
                    } else {
                        result = null;
                        break;
                    }
                }
            }

            return result;
        }

        function loadBundle(token) {
            var path = token ? token.split('.') : '',
                root = bundles,
                url = localeConf.basePath + '/' + currentLocale,
                i;

            if (path.length > 1) {
                for (i = 0; i < path.length - 1; i++) {
                    if (!root[path[i]]) {
                        root[path[i]] = {};
                    }
                    root = root[path[i]];
                    url += '/' + path[i];
                }

                if (!root._loading) {
                    root._loading = true;

                    url += localeConf.fileExtension;

                    $http.get(url)
                        .success(function (data) {
                            var key,
                                path = getPath(token);
                            // Merge the contents of the obtained data into the stored bundle.
                            for (key in data) {
                                if (data.hasOwnProperty(key)) {
                                    root[key] = data[key];
                                }
                            }

                            // Mark the bundle as having been "loaded".
                            delete root._loading;

                            // Notify anyone who cares to know about this event.
                            $rootScope.$broadcast(localeEvents.resourceUpdates);

                            // If we issued a Promise for this file, resolve it now.
                            if (deferrences[path]) {
                                deferrences[path].resolve(path);
                            }
                        })
                        .error(function () {
                            $log.error('[localizationService] Failed to load: ' + url);

                            // We can try it again later.
                            delete root._loading;
                        });
                }
            }
        }

        function bundleReady(path) {
            var bundle,
                token;

            path = path || localeConf.langFile;
            token = path + '._LOOKUP_';

            bundle = getBundle(token);

            if (!deferrences[path]) {
                deferrences[path] = $q.defer();
            }

            if (bundle && !bundle._loading) {
                deferrences[path].resolve(path);
            } else {
                if (!bundle) {
                    loadBundle(token);
                }
            }

            return deferrences[path].promise;
        }

        function ready(path) {
            var paths,
                deferred,
                outstanding;

            if (angular.isString(path)) {
                paths = path.split(',');
            } else if (angular.isArray(path)) {
                paths = path;
            } else {
                throw new Error('locale.ready requires either an Array or comma-separated list.');
            }

            if (paths.length > 1) {
                outstanding = [];
                paths.forEach(function (path) {
                    outstanding.push(bundleReady(path));
                });
                deferred = $q.all(outstanding);
            } else {
                deferred = bundleReady(path);
            }

            return deferred;
        }

        function applySubstitutions(text, subs) {
            var res = text,
                firstOfKind = 0;

            if (subs) {
                if (angular.isArray(subs)) {
                    angular.forEach(subs, function (sub, i) {
                        res = res.replace('%' + (i + 1), sub);
                        res = res.replace('{' + (i + 1) + '}', sub);
                    });
                } else {
                    angular.forEach(subs, function (v, k) {
                        ++firstOfKind;

                        res = res.replace('{' + k + '}', v);
                        res = res.replace('%' + k, v);
                        res = res.replace('%' + (firstOfKind), v);
                        res = res.replace('{' + (firstOfKind) + '}', v);
                    });
                }
            }
            res = res.replace(/\n/g, '<br>');

            return res;
        }

        function getLocalizedString(txt, subs) {
            var result = '',
                bundle,
                key,
                A,
                isValidToken = false;

            if (angular.isString(txt) && !subs && txt.indexOf(localeConf.delimiter) !== -1) {
                A = txt.split(localeConf.delimiter);
                txt = A[0];
                subs = angular.fromJson(A[1]);
            }

            isValidToken = isToken(txt);
            if (isValidToken) {
                if (!angular.isObject(subs)) {
                    subs = [subs];
                }

                bundle = getBundle(txt);
                if (bundle && !bundle._loading) {
                    key = getKey(txt);

                    if (bundle[key]) {
                        result = applySubstitutions(bundle[key], subs);
                    } else {
                        $log.info('[localizationService] Key not found: ' + txt);
                        result = '%%KEY_NOT_FOUND%%';
                    }
                } else {
                    if (!bundle) {
                        loadBundle(txt);
                    }
                }
            } else {
                result = txt;
            }

            return result;
        }

        function updateHtmlTagLangAttr(lang) {
            lang = lang.split('-')[0];

            $html.attr('lang', lang);
        }

        function setLocale(value) {
            var lang;

            if (angular.isString(value)) {
                value = value.trim();
                if (localeSupported.indexOf(value) !== -1) {
                    lang = value;
                } else {
                    lang = localeFallbacks[value.split('-')[0]];
                    if (angular.isUndefined(lang)) {
                        lang = localeConf.defaultLocale;
                    }
                }
            } else {
                lang = localeConf.defaultLocale;
            }

            if (lang !== currentLocale) {
                bundles = {};
                deferrences = {};
                currentLocale = lang;

                updateHtmlTagLangAttr(lang);

                $rootScope.$broadcast(localeEvents.localeChanges, currentLocale);
                $rootScope.$broadcast(localeEvents.resourceUpdates);

                if (cookieStore) {
                    cookieStore.put(localeConf.cookieName, lang);
                }
            }
        }

        function getLocale() {
            return currentLocale;
        }

        setLocale(cookieStore && cookieStore.get(localeConf.cookieName) ? cookieStore.get(localeConf.cookieName) : $window.navigator.userLanguage || $window.navigator.language);

        return {
            ready: ready,
            isToken: isToken,
            getPath: getPath,
            getKey: getKey,
            setLocale: setLocale,
            getLocale: getLocale,
            getString: getLocalizedString
        };
    });
