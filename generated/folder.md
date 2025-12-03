---
## => Content Auto Generated, 02 DEC 2025 21:12 UTC
---

## Watch Folders

<details>
  <summary>Examples. Prefix: <b>UN_FOLDER_</b>, Header: <b> [[folder]]</b></summary>

- Using the config file:

```yaml
##################################################################################
### ###  STOP HERE ### STOP HERE ### STOP HERE ### STOP HERE #### STOP HERE  ### #
### Only using Starr apps? The things above. The below configs are OPTIONAL. ### #
##################################################################################


##-Folders-#######################################################################
## This application can also watch folders for things to extract. If you copy a ##
## subfolder into a watched folder (defined below) any extractable items in the ##
## folder will be decompressed. This has nothing to do with Starr applications. ##
##################################################################################
[[folder]]
 path = '/downloads/auto_extract'
## Path to extract files to. The default (leaving this blank) is the same as `path` (above).
 extract_path = ''
## Delete extracted or original files this long after extraction.
## The default is 0. Set to 0 to disable all deletes. Uncomment it to enable deletes. Uses Go Duration.
 delete_after = "10m"
## Unpackerr extracts archives inside archives. Set this to true to disable recursive extractions.
 disable_recursion = false
## Delete extracted files after successful extraction? Honors delete_after.
 delete_files = false
## Delete original items after successful extraction? Honors delete_after.
 delete_original = false
## Disable extraction log (unpackerred.txt) file creation?
 disable_log = false
## Move extracted files into original folder? If false, files go into an _unpackerred folder.
 move_back = false
## Set this to true if you want this app to extract ISO files with .iso extension.
 extract_isos = false
```

- Using environment variables:

```js
## Watch Folders
UN_FOLDER_0_PATH=/downloads/auto_extract
UN_FOLDER_0_EXTRACT_PATH=
UN_FOLDER_0_DELETE_AFTER=10m
UN_FOLDER_0_DISABLE_RECURSION=false
UN_FOLDER_0_DELETE_FILES=false
UN_FOLDER_0_DELETE_ORIGINAL=false
UN_FOLDER_0_DISABLE_LOG=false
UN_FOLDER_0_MOVE_BACK=false
UN_FOLDER_0_EXTRACT_ISOS=false
```

</details>

Folders are a way to watch a folder for things to extract. You can use this to
monitor your download client's "move to" path if you're not using it with an Starr app.

|Config Name|Variable Name|Default / Note|
|---|---|---|
|path|`UN_FOLDER_PATH`|No Default / Folder to watch for archives. **Not for Starr apps.**|
|extract_path|`UN_FOLDER_EXTRACT_PATH`|No Default / Where to extract to. Uses `path` if not set.|
|delete_after|`UN_FOLDER_DELETE_AFTER`|`"10m"` / Delete requested files after this duration; `0` disables.|
|disable_recursion|`UN_FOLDER_DISABLE_RECURSION`|`false` / Setting this to true disables extracting archives inside archives.|
|delete_files|`UN_FOLDER_DELETE_FILES`|`false` / Delete extracted files after successful extraction.|
|delete_original|`UN_FOLDER_DELETE_ORIGINAL`|`false` / Delete archives after successful extraction.|
|disable_log|`UN_FOLDER_DISABLE_LOG`|`false` / Turns off creation of extraction logs files for this folder.|
|move_back|`UN_FOLDER_MOVE_BACK`|`false` / Move extracted items back into original folder.|
|extract_isos|`UN_FOLDER_EXTRACT_ISOS`|`false` / Setting this to true enables .iso file extraction.|

