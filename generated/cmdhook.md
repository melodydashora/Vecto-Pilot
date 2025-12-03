---
## => Content Auto Generated, 02 DEC 2025 21:12 UTC
---

## Command Hooks

<details>
  <summary>Examples. Prefix: <b>UN_CMDHOOK_</b>, Header: <b> [[cmdhook]]</b></summary>

- Using the config file:

```yaml
#####################
### Command Hooks ###
#####################
# Executes a script or command when an extraction queues, starts, finishes, and/or is deleted.
# All data is passed in as environment variables. Try /usr/bin/env to see what variables are available.
###### Don't forget to uncomment [[cmdhook]] at a minimum !!!!
[[cmdhook]]
 command = '/downloads/scripts/command.sh'
## Provide an optional name to hide the URL in logs.
## If a name is not provided the first word in the command is used.
 name = ""
## Runs the command inside /bin/sh ('nix) or cmd.exe (Windows).
 shell = false
## Do not log command's output.
 silent = false
## List of event ids to run command for, [0] for all.
## The default is [0] and this is an example:
 events = [1, 4, 7]
## ===> Optional Command Hook Configuration <===
## List of apps to exclude. None by default. This is an example:
 exclude = ["readarr", "lidarr"]
## You can adjust how long to wait for the command to run.
 timeout = "10s"
```

- Using environment variables:

```js
## Command Hooks
UN_CMDHOOK_0_COMMAND=/downloads/scripts/command.sh
UN_CMDHOOK_0_NAME=
UN_CMDHOOK_0_SHELL=false
UN_CMDHOOK_0_SILENT=false
UN_CMDHOOK_0_EVENTS_0=1
UN_CMDHOOK_0_EVENTS_1=4
UN_CMDHOOK_0_EVENTS_2=7
UN_CMDHOOK_0_EXCLUDE_0=readarr
UN_CMDHOOK_0_EXCLUDE_1=lidarr
UN_CMDHOOK_0_TIMEOUT=10s
```

</details>

Unpackerr can execute commands (or scripts) before and after an archive extraction.
The only thing required is a command. Name is optional, and used in logs only.
Setting `shell` to `true` executes your command after `/bin/sh -c` or `cmd.exe /c`
on Windows.

|Config Name|Variable Name|Default / Note|
|---|---|---|
|command|`UN_CMDHOOK_COMMAND`|No Default / Command to run.|
|name|`UN_CMDHOOK_NAME`|No Default / Name for logs, otherwise uses first word in command.|
|shell|`UN_CMDHOOK_SHELL`|`false` / Run command inside a shell.|
|silent|`UN_CMDHOOK_SILENT`|`false` / Hide command output from logs.|
|events|`UN_CMDHOOK_EVENTS_0`|`[0]` / List of event ids to run command for, `0` for all.|
|exclude|`UN_CMDHOOK_EXCLUDE_0`|`[]` / List of apps to exclude: radarr, sonarr, folders, etc.|
|timeout|`UN_CMDHOOK_TIMEOUT`|`"10s"` / How long to wait for the command to run.|

All extraction data is input to the command using environment variables, see example below.
Extracted files variables names begin with `UN_DATA_FILES_`.
Try `/usr/bin/env` as an example command to see what variables are available.

<details>
  <summary>Example Output Variables</summary>

```none
UN_DATA_OUTPUT=folder/subfolder_unpackerred
UN_PATH=folder/subfolder
UN_DATA_START=2021-10-04T23:04:27.849216-07:00
UN_REVISION=
UN_EVENT=extracted
UN_GO=go1.17
UN_DATA_ARCHIVES=folder/subfolder_unpackerred/Funjetting.rar,folder/subfolder_unpackerred/Funjetting.r00,folder/subfolder/files.zip
UN_DATA_ARCHIVE_2=folder/subfolder/files.zip
UN_DATA_ARCHIVE_1=folder/subfolder_unpackerred/Funjetting.r00
UN_DATA_ARCHIVE_0=folder/subfolder_unpackerred/Funjetting.rar
UN_DATA_FILES=folder/subfolder/Funjetting.mp3,folder/subfolder/Funjetting.r00,folder/subfolder/Funjetting.rar,folder/subfolder/_unpackerred.subfolder.txt
UN_DATA_FILE_1=folder/subfolder/Funjetting.r00
UN_DATA_BYTES=2407624
PWD=/Users/david/go/src/github.com/Unpackerr/unpackerr
UN_DATA_FILE_0=folder/subfolder/Funjetting.mp3
UN_OS=darwin
UN_DATA_FILE_3=folder/subfolder/_unpackerred.subfolder.txt
UN_DATA_FILE_2=folder/subfolder/Funjetting.rar
UN_BRANCH=
UN_TIME=2021-10-04T23:04:27.869613-07:00
UN_VERSION=
UN_DATA_QUEUE=0
SHLVL=1
UN_APP=Folder
UN_STARTED=2021-10-04T23:03:22.849253-07:00
UN_ARCH=amd64
UN_DATA_ELAPSED=20.365752ms
UN_DATA_ERROR=
```

</details>
