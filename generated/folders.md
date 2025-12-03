---
## => Content Auto Generated, 02 DEC 2025 21:12 UTC
---

## Folder Settings

<details>
  <summary>Examples. Prefix: <b>UN_FOLDERS_</b>, Header: <b> [folders]</b></summary>

- Using the config file:

```yaml
## Global Folder configuration that affects all watched folders.
[folders]
## How often poller checks for new folders.
## The default of `0s` will disable the poller on all systems except Docker.
## Set this value to `1ms` to disable it in Docker.
 interval = "0s"
## How many new folder events can be immediately queued. Don't change this.
 buffer = 20000
```

- Using environment variables:

```js
## Folder Settings
UN_FOLDERS_INTERVAL=0s
UN_FOLDERS_BUFFER=20000
```

</details>


|Config Name|Variable Name|Default / Note|
|---|---|---|
|interval|`UN_FOLDERS_INTERVAL`|`"0s"` / How often poller checks for new folders. Use `1ms` to disable it.|
|buffer|`UN_FOLDERS_BUFFER`|`20000` / How many new folder events can be immediately queued.|

