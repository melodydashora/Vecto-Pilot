---
## => Content Auto Generated, 02 DEC 2025 21:12 UTC
---

## Web Hooks

<details>
  <summary>Examples. Prefix: <b>UN_WEBHOOK_</b>, Header: <b> [[webhook]]</b></summary>

- Using the config file:

```yaml
################
### Webhooks ###
################
# Sends a webhook when an extraction queues, starts, finishes, and/or is deleted.
# Created to integrate with notifiarr.com.
# Also works natively with Discord.com, Telegram.org, and Slack.com webhooks.
# Can possibly be used with other services by providing a custom template_path.
###### Don't forget to uncomment [[webhook]] and url at a minimum !!!!
[[webhook]]
 url = "https://notifiarr.com/api/v1/notification/unpackerr/api_key_from_notifiarr_com"
## Provide an optional name to hide the URL in logs.
## If a name is not provided then the URL is used.
 name = ""
## Do not log success (less log spam).
 silent = false
## List of event ids to send notification for, [0] for all.
## The default is [0] and this is an example:
 events = [1, 4, 6]
## ===> Advanced Optional Webhook Configuration <===
## Used in Discord and Slack templates as bot name, in Telegram as chat_id.
 nickname = "Unpackerr"
## Also passed into templates. Used in Slack templates for destination channel.
 channel = ""
## List of apps to exclude. None by default. This is an example:
 exclude = ["readarr", "lidarr"]
## Override internal webhook template for discord.com or other hooks.
 template_path = ''
## Override automatic template detection. Values: notifiarr, discord, telegram, gotify, pushover, slack
 template = ""
## Set this to true to ignore the SSL certificate on the server.
 ignore_ssl = false
## You can adjust how long to wait for a server response.
 timeout = "10s"
## If your custom template uses another MIME type, set this.
 content_type = "application/json"
```

- Using environment variables:

```js
## Web Hooks
UN_WEBHOOK_0_URL=https://notifiarr.com/api/v1/notification/unpackerr/api_key_from_notifiarr_com
UN_WEBHOOK_0_NAME=
UN_WEBHOOK_0_SILENT=false
UN_WEBHOOK_0_EVENTS_0=1
UN_WEBHOOK_0_EVENTS_1=4
UN_WEBHOOK_0_EVENTS_2=6
UN_WEBHOOK_0_NICKNAME=Unpackerr
UN_WEBHOOK_0_CHANNEL=
UN_WEBHOOK_0_EXCLUDE_0=readarr
UN_WEBHOOK_0_EXCLUDE_1=lidarr
UN_WEBHOOK_0_TEMPLATE_PATH=
UN_WEBHOOK_0_TEMPLATE=
UN_WEBHOOK_0_IGNORE_SSL=false
UN_WEBHOOK_0_TIMEOUT=10s
UN_WEBHOOK_0_CONTENT_TYPE=application/json
```

</details>

This application can send a `POST` webhook to a URL when an extraction begins, and again
when it finishes. Configure 1 or more webhook URLs with the parameters below.
Works great with [notifiarr.com](https://notifiarr.com). You can use
[requestbin.com](https://requestbin.com/r/) to test and _see_ the payload.

|Config Name|Variable Name|Default / Note|
|---|---|---|
|url|`UN_WEBHOOK_URL`|No Default / URL to send POST webhook to.|
|name|`UN_WEBHOOK_NAME`|No Default / Provide an optional name to hide the URL in logs.|
|silent|`UN_WEBHOOK_SILENT`|`false` / Hide successful POSTs from logs.|
|events|`UN_WEBHOOK_EVENTS_0`|`[0]` / List of event ids to send notification for, `0` for all.|
|nickname|`UN_WEBHOOK_NICKNAME`|`"Unpackerr"` / Passed into templates for telegram, discord and slack hooks.|
|channel|`UN_WEBHOOK_CHANNEL`|No Default / Passed into templates for slack.com webhooks.|
|exclude|`UN_WEBHOOK_EXCLUDE_0`|`[]` / List of apps to exclude: radarr, sonarr, folders, etc.|
|template_path|`UN_WEBHOOK_TEMPLATE_PATH`|No Default / Instead of an internal template, provide your own.|
|template|`UN_WEBHOOK_TEMPLATE`|No Default / Instead of auto template selection, force a built-in template.|
|ignore_ssl|`UN_WEBHOOK_IGNORE_SSL`|`false` / Ignore invalid SSL certificates.|
|timeout|`UN_WEBHOOK_TIMEOUT`|`"10s"` / How long to wait for server response.|
|content_type|`UN_WEBHOOK_CONTENT_TYPE`|`"application/json"` / Content-Type header sent to webhook.|

### Notes for Web Hooks

- _`Nickname` should equal the `chat_id` value in Telegram webhooks._
- _`Channel` is used as destination channel for Slack. It's not used in others._
- _`Nickname` and `Channel` may be used as custom values in custom templates._
- _`Name` is only used in logs, but it's also available as a template value as `{{name}}`._
- Built-In Templates: `pushover`, `telegram`, `discord`, `notifiarr`, `slack`, `gotify`.
