---
## => Content Auto Generated, 02 DEC 2025 21:12 UTC
---

## Web Server

<details>
  <summary>Examples. Prefix: <b>UN_WEBSERVER_</b>, Header: <b> [webserver]</b></summary>

- Using the config file:

```yaml
[webserver]
## The web server currently only supports metrics; set this to true if you wish to use it.
 metrics = false
## This may be set to a port or an ip:port to bind a specific IP. 0.0.0.0 binds ALL IPs.
 listen_addr = "0.0.0.0:5656"
## Recommend setting a log file for HTTP requests. Otherwise, they go with other logs.
 log_file = ''
## This app automatically rotates logs. Set these to the size and number to keep.
 log_files = 10
 log_file_mb = 10
## Set both of these to valid file paths to enable HTTPS/TLS.
 ssl_cert_file = ''
 ssl_key_file = ''
## Base URL from which to serve content.
 urlbase = "/"
## Upstreams should be set to the IP or CIDR of your trusted upstream proxy.
## Setting this correctly allows X-Forwarded-For to be used in logs.
## In the future it may control auth proxy trust. Must be a list of strings.
## example: upstreams = [ "127.0.0.1/32", "10.1.2.0/24" ]
 upstreams = []
```

- Using environment variables:

```js
## Web Server
UN_WEBSERVER_METRICS=false
UN_WEBSERVER_LISTEN_ADDR=0.0.0.0:5656
UN_WEBSERVER_LOG_FILE=
UN_WEBSERVER_LOG_FILES=10
UN_WEBSERVER_LOG_FILE_MB=10
UN_WEBSERVER_SSL_CERT_FILE=
UN_WEBSERVER_SSL_KEY_FILE=
UN_WEBSERVER_URLBASE=/
UN_WEBSERVER_UPSTREAMS=
```

</details>

:::note Metrics
The web server currently only provides prometheus metrics, which you can display in
[Grafana](https://grafana.com/grafana/dashboards/18817-unpackerr/).
It provides no UI. This may change in the future. The web server was added in v0.12.0.
:::

|Config Name|Variable Name|Default / Note|
|---|---|---|
|metrics|`UN_WEBSERVER_METRICS`|`false` / Extracted folders are written with this mode|
|listen_addr|`UN_WEBSERVER_LISTEN_ADDR`|`"0.0.0.0:5656"` / ip:port to listen on; `0.0.0.0` is all IPs.|
|log_file|`UN_WEBSERVER_LOG_FILE`|No Default / Provide optional file path to write HTTP logs.|
|log_files|`UN_WEBSERVER_LOG_FILES`|`10` / Log files to keep after rotating. `0` to disable.|
|log_file_mb|`UN_WEBSERVER_LOG_FILE_MB`|`10` / Max size of HTTP log files in megabytes|
|ssl_cert_file|`UN_WEBSERVER_SSL_CERT_FILE`|No Default / Path to SSL cert file to serve HTTPS.|
|ssl_key_file|`UN_WEBSERVER_SSL_KEY_FILE`|No Default / Path to SSL key file to serve HTTPS.|
|urlbase|`UN_WEBSERVER_URLBASE`|`"/"` / Base URL path to serve HTTP content.|
|upstreams|`UN_WEBSERVER_UPSTREAMS`|`[]` / List of upstream proxy CIDRs or IPs to trust.|

