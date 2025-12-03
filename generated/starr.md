---
## => Content Auto Generated, 02 DEC 2025 21:12 UTC
---

## Sonarr Settings

<details>
  <summary>Examples. Prefix: <b>UN_SONARR_</b>, Header: <b> [[sonarr]]</b></summary>

- Using the config file:

```yaml
## Leaving the [[sonarr]] header uncommented (no leading hash #) without also
## uncommenting the api_key (remove the hash #) will produce a startup warning.
[[sonarr]]
 url = "http://127.0.0.1:8989"
 api_key = "0123456789abcdef0123456789abcdef"
## List of paths where content is downloaded for this app.
## Used as fallback if the path the Starr app reports does not exist or is not accessible.
 paths = ['/downloads']
## Default protocols is torrent. Alternative: "torrent,usenet"
 protocols = "torrent"
## How long to wait for a reply from the backend.
 timeout = "10s"
## How long to wait after import before deleting the extracted items.
 delete_delay = "5m"
## If you use this app with NZB you may wish to delete archives after extraction.
## General recommendation is: do not enable this for torrent use.
## Setting this to true deletes the entire original download folder after import.
 delete_orig = false
## If you use Syncthing, setting this to true will make unpackerr wait for syncs to finish.
 syncthing = false
```

- Using environment variables:

```js
## Sonarr Settings
UN_SONARR_0_URL=http://127.0.0.1:8989
UN_SONARR_0_API_KEY=0123456789abcdef0123456789abcdef
UN_SONARR_0_PATHS_0=/downloads
UN_SONARR_0_PROTOCOLS=torrent
UN_SONARR_0_TIMEOUT=10s
UN_SONARR_0_DELETE_DELAY=5m
UN_SONARR_0_DELETE_ORIG=false
UN_SONARR_0_SYNCTHING=false
```

</details>


|Config Name|Variable Name|Default / Note|
|---|---|---|
|url|`UN_SONARR_URL`|`"http://127.0.0.1:8989"` / URL where this starr app can be accessed.|
|api_key|`UN_SONARR_API_KEY`|No Default / Provide URL and API key if you use this app.|
|paths|`UN_SONARR_PATHS_0`|`["/downloads"]` / File system path where downloaded items are located.|
|protocols|`UN_SONARR_PROTOCOLS`|`"torrent"` / Protocols to process. Alt: `torrent,usenet`|
|timeout|`UN_SONARR_TIMEOUT`|`"10s"` / How long to wait for the app to respond.|
|delete_delay|`UN_SONARR_DELETE_DELAY`|`"5m"` / Extracts are deleted this long after import, `-1s` to disable.|
|delete_orig|`UN_SONARR_DELETE_ORIG`|`false` / Delete archives after import? Recommend keeping this false.|
|syncthing|`UN_SONARR_SYNCTHING`|`false` / Setting this to true makes unpackerr wait for syncthing to finish.|

## Radarr Settings

<details>
  <summary>Examples. Prefix: <b>UN_RADARR_</b>, Header: <b> [[radarr]]</b></summary>

- Using the config file:

```yaml
## Leaving the [[radarr]] header uncommented (no leading hash #) without also
## uncommenting the api_key (remove the hash #) will produce a startup warning.
[[radarr]]
 url = "http://127.0.0.1:7878"
 api_key = "0123456789abcdef0123456789abcdef"
## List of paths where content is downloaded for this app.
## Used as fallback if the path the Starr app reports does not exist or is not accessible.
 paths = ['/downloads']
## Default protocols is torrent. Alternative: "torrent,usenet"
 protocols = "torrent"
## How long to wait for a reply from the backend.
 timeout = "10s"
## How long to wait after import before deleting the extracted items.
 delete_delay = "5m"
## If you use this app with NZB you may wish to delete archives after extraction.
## General recommendation is: do not enable this for torrent use.
## Setting this to true deletes the entire original download folder after import.
 delete_orig = false
## If you use Syncthing, setting this to true will make unpackerr wait for syncs to finish.
 syncthing = false
```

- Using environment variables:

```js
## Radarr Settings
UN_RADARR_0_URL=http://127.0.0.1:7878
UN_RADARR_0_API_KEY=0123456789abcdef0123456789abcdef
UN_RADARR_0_PATHS_0=/downloads
UN_RADARR_0_PROTOCOLS=torrent
UN_RADARR_0_TIMEOUT=10s
UN_RADARR_0_DELETE_DELAY=5m
UN_RADARR_0_DELETE_ORIG=false
UN_RADARR_0_SYNCTHING=false
```

</details>


|Config Name|Variable Name|Default / Note|
|---|---|---|
|url|`UN_RADARR_URL`|`"http://127.0.0.1:7878"` / URL where this starr app can be accessed.|
|api_key|`UN_RADARR_API_KEY`|No Default / Provide URL and API key if you use this app.|
|paths|`UN_RADARR_PATHS_0`|`["/downloads"]` / File system path where downloaded items are located.|
|protocols|`UN_RADARR_PROTOCOLS`|`"torrent"` / Protocols to process. Alt: `torrent,usenet`|
|timeout|`UN_RADARR_TIMEOUT`|`"10s"` / How long to wait for the app to respond.|
|delete_delay|`UN_RADARR_DELETE_DELAY`|`"5m"` / Extracts are deleted this long after import, `-1s` to disable.|
|delete_orig|`UN_RADARR_DELETE_ORIG`|`false` / Delete archives after import? Recommend keeping this false.|
|syncthing|`UN_RADARR_SYNCTHING`|`false` / Setting this to true makes unpackerr wait for syncthing to finish.|

## Lidarr Settings

<details>
  <summary>Examples. Prefix: <b>UN_LIDARR_</b>, Header: <b> [[lidarr]]</b></summary>

- Using the config file:

```yaml
[[lidarr]]
 url = "http://127.0.0.1:8686"
 api_key = "0123456789abcdef0123456789abcdef"
## List of paths where content is downloaded for this app.
## Used as fallback if the path the Starr app reports does not exist or is not accessible.
 paths = ['/downloads']
## Default protocols is torrent. Alternative: "torrent,usenet"
 protocols = "torrent"
## How long to wait for a reply from the backend.
 timeout = "10s"
## How long to wait after import before deleting the extracted items.
 delete_delay = "5m"
## If you use this app with NZB you may wish to delete archives after extraction.
## General recommendation is: do not enable this for torrent use.
## Setting this to true deletes the entire original download folder after import.
 delete_orig = false
## If you use Syncthing, setting this to true will make unpackerr wait for syncs to finish.
 syncthing = false
```

- Using environment variables:

```js
## Lidarr Settings
UN_LIDARR_0_URL=http://127.0.0.1:8686
UN_LIDARR_0_API_KEY=0123456789abcdef0123456789abcdef
UN_LIDARR_0_PATHS_0=/downloads
UN_LIDARR_0_PROTOCOLS=torrent
UN_LIDARR_0_TIMEOUT=10s
UN_LIDARR_0_DELETE_DELAY=5m
UN_LIDARR_0_DELETE_ORIG=false
UN_LIDARR_0_SYNCTHING=false
```

</details>


|Config Name|Variable Name|Default / Note|
|---|---|---|
|url|`UN_LIDARR_URL`|`"http://127.0.0.1:8686"` / URL where this starr app can be accessed.|
|api_key|`UN_LIDARR_API_KEY`|No Default / Provide URL and API key if you use this app.|
|paths|`UN_LIDARR_PATHS_0`|`["/downloads"]` / File system path where downloaded items are located.|
|protocols|`UN_LIDARR_PROTOCOLS`|`"torrent"` / Protocols to process. Alt: `torrent,usenet`|
|timeout|`UN_LIDARR_TIMEOUT`|`"10s"` / How long to wait for the app to respond.|
|delete_delay|`UN_LIDARR_DELETE_DELAY`|`"5m"` / Extracts are deleted this long after import, `-1s` to disable.|
|delete_orig|`UN_LIDARR_DELETE_ORIG`|`false` / Delete archives after import? Recommend keeping this false.|
|syncthing|`UN_LIDARR_SYNCTHING`|`false` / Setting this to true makes unpackerr wait for syncthing to finish.|

## Readarr Settings

<details>
  <summary>Examples. Prefix: <b>UN_READARR_</b>, Header: <b> [[readarr]]</b></summary>

- Using the config file:

```yaml
[[readarr]]
 url = "http://127.0.0.1:8787"
 api_key = "0123456789abcdef0123456789abcdef"
## List of paths where content is downloaded for this app.
## Used as fallback if the path the Starr app reports does not exist or is not accessible.
 paths = ['/downloads']
## Default protocols is torrent. Alternative: "torrent,usenet"
 protocols = "torrent"
## How long to wait for a reply from the backend.
 timeout = "10s"
## How long to wait after import before deleting the extracted items.
 delete_delay = "5m"
## If you use this app with NZB you may wish to delete archives after extraction.
## General recommendation is: do not enable this for torrent use.
## Setting this to true deletes the entire original download folder after import.
 delete_orig = false
## If you use Syncthing, setting this to true will make unpackerr wait for syncs to finish.
 syncthing = false
```

- Using environment variables:

```js
## Readarr Settings
UN_READARR_0_URL=http://127.0.0.1:8787
UN_READARR_0_API_KEY=0123456789abcdef0123456789abcdef
UN_READARR_0_PATHS_0=/downloads
UN_READARR_0_PROTOCOLS=torrent
UN_READARR_0_TIMEOUT=10s
UN_READARR_0_DELETE_DELAY=5m
UN_READARR_0_DELETE_ORIG=false
UN_READARR_0_SYNCTHING=false
```

</details>


|Config Name|Variable Name|Default / Note|
|---|---|---|
|url|`UN_READARR_URL`|`"http://127.0.0.1:8787"` / URL where this starr app can be accessed.|
|api_key|`UN_READARR_API_KEY`|No Default / Provide URL and API key if you use this app.|
|paths|`UN_READARR_PATHS_0`|`["/downloads"]` / File system path where downloaded items are located.|
|protocols|`UN_READARR_PROTOCOLS`|`"torrent"` / Protocols to process. Alt: `torrent,usenet`|
|timeout|`UN_READARR_TIMEOUT`|`"10s"` / How long to wait for the app to respond.|
|delete_delay|`UN_READARR_DELETE_DELAY`|`"5m"` / Extracts are deleted this long after import, `-1s` to disable.|
|delete_orig|`UN_READARR_DELETE_ORIG`|`false` / Delete archives after import? Recommend keeping this false.|
|syncthing|`UN_READARR_SYNCTHING`|`false` / Setting this to true makes unpackerr wait for syncthing to finish.|

## Whisparr Settings

<details>
  <summary>Examples. Prefix: <b>UN_WHISPARR_</b>, Header: <b> [[whisparr]]</b></summary>

- Using the config file:

```yaml
[[whisparr]]
 url = "http://127.0.0.1:6969"
 api_key = "0123456789abcdef0123456789abcdef"
## List of paths where content is downloaded for this app.
## Used as fallback if the path the Starr app reports does not exist or is not accessible.
 paths = ['/downloads']
## Default protocols is torrent. Alternative: "torrent,usenet"
 protocols = "torrent"
## How long to wait for a reply from the backend.
 timeout = "10s"
## How long to wait after import before deleting the extracted items.
 delete_delay = "5m"
## If you use this app with NZB you may wish to delete archives after extraction.
## General recommendation is: do not enable this for torrent use.
## Setting this to true deletes the entire original download folder after import.
 delete_orig = false
## If you use Syncthing, setting this to true will make unpackerr wait for syncs to finish.
 syncthing = false
```

- Using environment variables:

```js
## Whisparr Settings
UN_WHISPARR_0_URL=http://127.0.0.1:6969
UN_WHISPARR_0_API_KEY=0123456789abcdef0123456789abcdef
UN_WHISPARR_0_PATHS_0=/downloads
UN_WHISPARR_0_PROTOCOLS=torrent
UN_WHISPARR_0_TIMEOUT=10s
UN_WHISPARR_0_DELETE_DELAY=5m
UN_WHISPARR_0_DELETE_ORIG=false
UN_WHISPARR_0_SYNCTHING=false
```

</details>


|Config Name|Variable Name|Default / Note|
|---|---|---|
|url|`UN_WHISPARR_URL`|`"http://127.0.0.1:6969"` / URL where this starr app can be accessed.|
|api_key|`UN_WHISPARR_API_KEY`|No Default / Provide URL and API key if you use this app.|
|paths|`UN_WHISPARR_PATHS_0`|`["/downloads"]` / File system path where downloaded items are located.|
|protocols|`UN_WHISPARR_PROTOCOLS`|`"torrent"` / Protocols to process. Alt: `torrent,usenet`|
|timeout|`UN_WHISPARR_TIMEOUT`|`"10s"` / How long to wait for the app to respond.|
|delete_delay|`UN_WHISPARR_DELETE_DELAY`|`"5m"` / Extracts are deleted this long after import, `-1s` to disable.|
|delete_orig|`UN_WHISPARR_DELETE_ORIG`|`false` / Delete archives after import? Recommend keeping this false.|
|syncthing|`UN_WHISPARR_SYNCTHING`|`false` / Setting this to true makes unpackerr wait for syncthing to finish.|

