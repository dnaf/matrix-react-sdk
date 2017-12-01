/*
Copyright 2017 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/*
Listens for incoming postMessage requests from embedded widgets. The following API is exposed:
{
    widgetData: {
        action: "content_loaded"
        // additional request fields
    },
    widgetId: $WIDGET_ID
}

The complete request object is returned to the caller with an additional "response" key like so:
{
    widgetData: {
        action: "content_loaded"
        // additional request fields
    },
    widgetId: $WIDGET_ID
    response: { ... }
}

The "action" determines the format of the request and response. All actions can return an error response.

A success response is an object with zero or more keys.

An error response is a "response" object which consists of a sole "error" key to indicate an error.
They look like:
{
    error: {
        message: "Unable to invite user into room.",
        _error: <Original Error Object>
    }
}
The "message" key should be a human-friendly string.

ACTIONS
=======
All actions can return an error response instead of the response outlined below.

content_loaded
--------------
Indicates that widget contet has fully loaded

Request:
 - widgetId is the unique ID of the widget instance in riot / matrix state.
 - No additional fields.
Response:
{
    success: true
}
Example:
{
    widgetData: {
        action: "content_loaded"
    },
    widgetId: $WIDGET_ID
}
*/

import dis from './dispatcher';

let listenerCount = 0;
let messageEndpoints = [];

/**
 * Handle widget postMessage events
 * @param  {Event} event Event to handle
 * @return {undefined}
 */
function onMessage(event) {
    if (!event.origin) { // Handle chrome
        event.origin = event.originalEvent.origin;
    }

    // Event origin is empty string if undefined
    if (
        event.origin.length === 0 ||
        trustedEndpoint(event.origin) ||
        !event.data.widgetData ||
        !event.data.widgetId
    ) {
        return; // don't log this - debugging APIs like to spam postMessage which floods the log otherwise
    }

    const widgetData = event.data.widgetData;
    const widgetId = event.data.widgetId;
    if (widgetData.action == 'content_loaded') {
        dis.dispatch({
            action: 'widget_content_loaded',
            widgetId: widgetId,
        });
        sendResponse(event, {success: true});
    } else {
        console.warn("Widget postMessage event unhandled");
        sendError(event, {message: "The postMessage was unhandled"});
    }
}

/**
 * Check if message origin is registered as trusted
 * @param  {string} origin PostMessage origin to check
 * @return {boolean}       True if trusted
 */
function trustedEndpoint(origin) {
    if (origin) {
        if (messageEndpoints.filter(function(endpoint) {
            if (endpoint.endpointUrl == origin) {
                return true;
            }
        }).length > 0) {
            return true;
        }
    }

    return false;
}

/**
 * Send a postmessage response to a postMessage request
 * @param  {Event} event  The original postMessage request event
 * @param  {Object} res   Response data
 */
function sendResponse(event, res) {
    const data = JSON.parse(JSON.stringify(event.data));
    data.response = res;
    event.source.postMessage(data, event.origin);
}

/**
 * Send an error response to a postMessage request
 * @param  {Event} event        The original postMessage request event
 * @param  {string} msg         Error message
 * @param  {Error} nestedError  Nested error event (optional)
 */
function sendError(event, msg, nestedError) {
    console.error("Action:" + event.data.action + " failed with message: " + msg);
    const data = JSON.parse(JSON.stringify(event.data));
    data.response = {
        error: {
            message: msg,
        },
    };
    if (nestedError) {
        data.response.error._error = nestedError;
    }
    event.source.postMessage(data, event.origin);
}

/**
 * Represents mapping of widget instance to URLs for trusted postMessage communication.
 */
class WidgetMessageEndpoint {
    /**
     * Mapping of widget instance to URL for trusted postMessage communication.
     * @param  {string} widgetId    Unique widget identifier
     * @param  {string} endpointUrl Widget wurl origin.
     */
    constructor(widgetId, endpointUrl) {
        if (!widgetId) {
            throw new Error("No widgetId specified in widgetMessageEndpoint constructor");
        }
        if (!endpointUrl) {
            throw new Error("No endpoint specified in widgetMessageEndpoint constructor");
        }
        this.widgetId = widgetId;
        this.endpointUrl = endpointUrl;
    }
}

module.exports = {
    /**
     * Register widget message event listeners
     */
    startListening() {
        if (listenerCount === 0) {
            window.addEventListener("message", onMessage, false);
        }
        listenerCount += 1;
    },

    /**
     * De-register widget message event listeners
     */
    stopListening() {
        listenerCount -= 1;
        if (listenerCount === 0) {
            window.removeEventListener("message", onMessage);
        }
        if (listenerCount < 0) {
            // Make an error so we get a stack trace
            const e = new Error(
                "WidgetMessaging: mismatched startListening / stopListening detected." +
                " Negative count",
            );
            console.error(e);
        }
    },

    /**
     * Register a widget endpoint for trusted postMessage communication
     * @param {string} widgetId    Unique widget identifier
     * @param {string} endpointUrl Widget wurl origin (protocol + (optional port) + host)
     */
    addEndpoint(widgetId, endpointUrl) {
        const endpoint = new WidgetMessageEndpoint(widgetId, endpointUrl);
        if (messageEndpoints && messageEndpoints.length > 0) {
            if (messageEndpoints.filter(function(ep) {
                return (ep.widgetId == widgetId && ep.endpointUrl == endpointUrl);
            }).length > 0) {
                // Message endpoint already registered
                return;
            }
            messageEndpoints.push(endpoint);
        }
    },

    /**
     * De-register a widget endpoint from trusted communication sources
     * @param  {string} widgetId Unique widget identifier
     * @param  {string} endpointUrl Widget wurl origin (protocol + (optional port) + host)
     * @return {boolean} True if endpoint was successfully removed
     */
    removeOrigin(widgetId, endpointUrl) {
        if (messageEndpoints && messageEndpoints.length > 0) {
            const length = messageEndpoints.length;
            messageEndpoints = messageEndpoints.filter(function(endpoint) {
                return (endpoint.widgetId != widgetId || endpoint.endpointUrl != endpointUrl);
            });
            return (length > messageEndpoints.length);
        }
        return false;
    },
};
