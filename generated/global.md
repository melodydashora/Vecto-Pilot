---
## => Content Auto Generated, 02 DEC 2025 21:12 UTC
---

## Global Settings

<details>
  <summary>Examples. Prefix: <b>UN_</b></summary>

- Using the config file:

```yaml
#######################################################
##       Unpackerr Example Configuration File        ##
#######################################################
##  The values are a mix of defaults and examples.   ##
##  Environment Variables may override all values.   ##
##  More configuration help: https://unpackerr.zip   ##
## Config Generator: https://notifiarr.com/unpackerr ##
#######################################################

## Turn on debug messages in the output. Do not wrap this in quotes.
## Recommend trying this so you know what it looks like. I personally leave it on.
debug = false

## Disable writing messages to stdout/stderr. This silences the app. Set a log
## file below if you set this to true. Recommended when starting with systemctl.
quiet = false

## Send error output to stderr instead of stdout by setting error_stderr to true.
## Recommend leaving this at false. Ignored if quiet (above) is true.
error_stderr = false

## Setting activity to true will silence all app queue log lines with only zeros.
## Set this to true when you want less log spam.
activity = false

## The Starr-application activity queue is logged on an interval.
## Adjust that interval with this setting.
## Default is a minute. 2m, 5m, 10m, 30m, 1h are also perfectly acceptable.
log_queues = "1m"

## Write messages to a log file. This is the same data that is normally output to stdout.
## This setting is great for Docker users that want to export their logs to a file.
## The alternative is to use syslog to log the output of the application to a file.
## Default is no log file; this is unset.
## Except on macOS and Windows, the log file gets set to "~/.unpackerr/unpackerr.log"
## log_files=0 turns off auto-rotation.
## Default files is 10 and size(mb) is 10 Megabytes; both doubled if debug is true.
log_file = '/downloads/unpackerr.log'
log_files = 10
log_file_mb = 10

## How often to poll starr apps (sonarr, radarr, etc).
## Recommend 1m-5m. Uses Go Duration.
interval = "2m"

## How long an item must be queued (download complete) before extraction will start.
## One minute is the historic default and works well. Set higher if your downloads
## take longer to finalize (or transfer locally). Uses Go Duration.
start_delay = "1m"

## How long to wait before removing the history for a failed extraction.
## Once the history is deleted the item will be recognized as new and
## extraction will start again. Uses Go Duration.
retry_delay = "5m"

## How many times to retry a failed extraction. Pauses retry_delay between attempts.
max_retries = 3

## How many files may be extracted in parallel. 1 works fine.
## Do not wrap the number in quotes. Raise this only if you have fast disks and CPU.
parallel = 1

## Use these configurations to control the file modes used for newly extracted
## files and folders. Recommend 0644/0755 or 0666/0777.
file_mode = "0644"
dir_mode = "0755"
```

- Using environment variables:

```js
## Global Settings
UN_DEBUG=false
UN_QUIET=false
UN_ERROR_STDERR=false
UN_ACTIVITY=false
UN_LOG_QUEUES=1m
UN_LOG_FILE=/downloads/unpackerr.log
UN_LOG_FILES=10
UN_LOG_FILE_MB=10
UN_INTERVAL=2m
UN_START_DELAY=1m
UN_RETRY_DELAY=5m
UN_MAX_RETRIES=3
UN_PARALLEL=1
UN_FILE_MODE=0644
UN_DIR_MODE=0755
```

</details>

These values must exist at the top of the config file.
If you put them anywhere else they may be attached to a `[header]` inadvertently.
When using environment variables, you can simply omit the ones you don't set or change from default.

|Config Name|Variable Name|Default / Note|
|---|---|---|
|debug|`UN_DEBUG`|`false` / Turns on more logs.|
|quiet|`UN_QUIET`|`false` / Do not print logs to stdout or stderr.|
|error_stderr|`UN_ERROR_STDERR`|`false` / Print ERROR lines to stderr instead of stdout.|
|activity|`UN_ACTIVITY`|`false` / Setting true will print only queue counts with activity.|
|log_queues|`UN_LOG_QUEUES`|`"1m"` / How often to print internal counters. Uses Go Duration.|
|log_file|`UN_LOG_FILE`|No Default / Provide optional file path to write logs|
|log_files|`UN_LOG_FILES`|`10` / Log files to keep after rotating. `0` disables rotation|
|log_file_mb|`UN_LOG_FILE_MB`|`10` / Max size of log files in megabytes|
|interval|`UN_INTERVAL`|`"2m"` / How often apps are polled, recommend `1m` to `5m`.|
|start_delay|`UN_START_DELAY`|`"1m"` / Files are queued at least this long before extraction.|
|retry_delay|`UN_RETRY_DELAY`|`"5m"` / Failed extractions are retried after at least this long.|
|max_retries|`UN_MAX_RETRIES`|`3` / Failed extractions are retried after at least this long.|
|parallel|`UN_PARALLEL`|`1` / Concurrent extractions, only recommend `1`|
|file_mode|`UN_FILE_MODE`|`"0644"` / Extracted files are written with this mode.|
|dir_mode|`UN_DIR_MODE`|`"0755"` / Extracted folders are written with this mode|

