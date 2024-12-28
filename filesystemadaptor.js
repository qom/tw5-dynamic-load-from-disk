/*\
title: $:/plugins/oveek/tiddlywiki/filesystem/filesystemadaptor.js
type: application/javascript
module-type: syncadaptor

A sync adaptor module for synchronising with the local filesystem via node.js APIs

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Get a reference to the file system
var fs = $tw.node ? require("fs") : null,
	path = $tw.node ? require("path") : null;

function FileSystemAdaptor(options) {
	var self = this;
	this.wiki = options.wiki;
    console.log("Loaded modified filesystem syncadaptor that can dynamically load from disk.");
	this.logger = new $tw.utils.Logger("filesystem",{colour: "blue"});
	// Create the <wiki>/tiddlers folder if it doesn't exist
	$tw.utils.createDirectory($tw.boot.wikiTiddlersPath);
    // Store the last modification time of every file at the time of startup
    var tiddlerFileDetails = this.listTiddlerFiles($tw.boot.wikiTiddlersPath);
    var fileStats = tiddlerFileDetails.stats;
    $tw.utils.each($tw.boot.files, tiddler => {
        var mTime = fileStats[tiddler.filepath].mtimeMs;
        tiddler.mtime = mTime;
    });
}

FileSystemAdaptor.prototype.name = "filesystem";

FileSystemAdaptor.prototype.isReady = function() {
	// The file system adaptor is always ready
	return true;
};

FileSystemAdaptor.prototype.getTiddlerInfo = function(tiddler) {
	return {};
};

/*
Return a fileInfo object for a tiddler, creating it if necessary:
  filepath: the absolute path to the file containing the tiddler
  type: the type of the tiddler file (NOT the type of the tiddler -- see below)
  hasMetaFile: true if the file also has a companion .meta file

The boot process populates $tw.boot.files for each of the tiddler files that it loads. The type is found by looking up the extension in $tw.config.fileExtensionInfo (eg "application/x-tiddler" for ".tid" files).

It is the responsibility of the filesystem adaptor to update $tw.boot.files for new files that are created.
*/
FileSystemAdaptor.prototype.getTiddlerFileInfo = function(tiddler,callback) {
	// See if we've already got information about this file
	var title = tiddler.fields.title,
		fileInfo = $tw.boot.files[title];
	if(!fileInfo) {
		// Otherwise, we'll need to generate it
		fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler,{
			directory: $tw.boot.wikiTiddlersPath,
			pathFilters: this.wiki.getTiddlerText("$:/config/FileSystemPaths","").split("\n"),
			wiki: this.wiki
		});
		$tw.boot.files[title] = fileInfo;
	}
	callback(null,fileInfo);
};

/*
Save a tiddler and invoke the callback with (err,adaptorInfo,revision)
*/
FileSystemAdaptor.prototype.saveTiddler = function(tiddler,callback) {
	var self = this;
	this.getTiddlerFileInfo(tiddler,function(err,fileInfo) {
		if(err) {
			return callback(err);
		}
        try {
		    $tw.utils.saveTiddlerToFileSync(tiddler,fileInfo);
            self.updateFileModificationTime(fileInfo.filepath);
            callback(null);
        } catch (e) {
           return callback(e); 
        }
	});
};

/*
Load a tiddler and invoke the callback with (err,tiddlerFields)

We don't need to implement loading for the file system adaptor, because all the tiddler files will have been loaded during the boot process.

(Implementation for this method added to support loading tiddlers created outside of tiddlywiki after the server already started.)
*/
FileSystemAdaptor.prototype.loadTiddler = function(title,callback) {
    
    // Load missing tiddlers
    if(!$tw.wiki.getTiddler(title) || $tw.boot.files[title].dirty == true) {   
    
        // Bit hacky: for a new file on disk, the title param is actually the file path for the new tiddler.
        var filepath = title.file ? title.file : $tw.boot.files[title].filepath;
        
        console.log(filepath);
        var tiddlerFiles = $tw.loadTiddlersFromFile(filepath,{title: filepath});
        
        // TODO: need to pass callback in case of error? Is the order of calls ok?
        // The call to makeOnDiskTiddlerFileInfo creates a new fileInfo entry in $tw.boot.files
        // and prevents the saveTiddler call from trying to save a tiddler file that's already on disk.
        // Add tiddlers to wiki store. 
        tiddlerFiles.tiddlers.forEach(tiddlerFields =>  {
            var tiddler = new $tw.Tiddler(tiddlerFields);
            var newInfo = {};
            this.makeOnDiskTiddlerFileInfo(tiddler, filepath, (err, fileInfo) => $tw.wiki.addTiddler(tiddler));
        });
        
    }
    
    if (callback) {
	    callback(null,null);
    }
};

/*
Delete a tiddler and invoke the callback with (err)
*/
FileSystemAdaptor.prototype.deleteTiddler = function(title,callback,options) {
	var self = this,
		fileInfo = $tw.boot.files[title];
	// Only delete the tiddler if we have writable information for the file
	if(fileInfo) {
		// Delete the file and tiddler fileInfo from $tw.boot.files
        this.deleteTiddlerFileInfo(title);
		fs.unlink(fileInfo.filepath,function(err) {
			if(err) {
				return callback(err);
			}
			// Delete the metafile if present
			if(fileInfo.hasMetaFile) {
				fs.unlink(fileInfo.filepath + ".meta",function(err) {
					if(err) {
						return callback(err);
					}
					return $tw.utils.deleteEmptyDirs(path.dirname(fileInfo.filepath),callback);
				});
			} else {
				return $tw.utils.deleteEmptyDirs(path.dirname(fileInfo.filepath),callback);
			}
		});
	} else {
		callback(null);
	}
};
    
/*** The methods below were added to support syncing on disk changes made from outside of tiddlywiki. ***/
    
 /*
Create fileInfo object For a tiddler file created outside of the wiki. We overwrite the 
"uniquified" file name generateTiddlerFileInfo() creates for existing files.
*/
FileSystemAdaptor.prototype.makeOnDiskTiddlerFileInfo = function(tiddler,path,callback) {
	// See if we've already got information about this file
	var title = tiddler.fields.title,
		fileInfo = $tw.boot.files[title];
	if(!fileInfo) {
		// Otherwise, we'll need to generate it
		fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler,{
			directory: $tw.boot.wikiTiddlersPath,
			pathFilters: this.wiki.getTiddlerText("$:/config/FileSystemPaths","").split("\n"),
			wiki: this.wiki
		});
        
        // Overwrite the uniqueified file name
        fileInfo.filepath = path;
        
        // Save the last modified time
        var stat = fs.statSync(path);
        fileInfo.mtime = stat.mtimeMs;
        
		$tw.boot.files[title] = fileInfo;
	}
	callback(null,fileInfo);
};
    
/*
Delete tiddler fileInfo so that $tw.boot.files doesn't contain entries for tiddlers that were deleted.
*/
FileSystemAdaptor.prototype.deleteTiddlerFileInfo = function(title,callback) {
    var fileInfo = $tw.boot.files[title],
        updatedFiles = {};
    
    // Too slow to do on every delete?
    for (var file in $tw.boot.files) {
        if (file != title) {
            updatedFiles[file] = $tw.boot.files[file]
        }
    }
    
    // Will this cause memory leak? When will the original file object be garbage collected?
    $tw.boot.files = updatedFiles;
}
    
/*
Helper method to record tiddler file modification time in $tw.boot.files after saving.
*/
FileSystemAdaptor.prototype.updateFileModificationTime = function (filepath) {
    var stat = null;
    var lastMtime = null;
    var count = 0;
    var maxTries = 3;
    while(stat == null || !stat.mtimeMs == lastMtime) {
        try {
            count++;
        	lastMtime = stat ? stat.mtimeMs : 0;
            stat = fs.statSync(filepath);
            console.log(stat.mtimeMs);
        } catch (e) {
            // handle exception
            if (++count == maxTries) {
              console.log("Error updating file modification time for: " + filepath);
              throw e;  
            } 
        }
    }
    
    $tw.utils.each($tw.boot.files, file => {
       if (file.filepath == filepath) {
           file.mtime = stat.mtimeMs;
       } 
    });
}
    
FileSystemAdaptor.prototype.syncChangesFromDisk = function() {
    
    var self = this;
    var deletedInfo = [];
    var changedTiddlers = this.listNewOrRemoved();
    
    // Note: if the deleted tiddler file name doesn't match the tiddler title
   /* changedTiddlers.deleted.forEach(title => filesystemAdaptor.deleteTiddler(title));
    changedTiddlers.new.forEach(title => filesystemAdaptor.loadTiddler(title));*/
    
    // $tw.boot.files maps title to filepath. pathToTitle maps filepath to title
    // to enable looking up a tiddler file's title without needing to read the tiddler file from disk.
    var pathToTitle = {};
    for (var tiddler in $tw.boot.files) {
        pathToTitle[$tw.boot.files[tiddler].filepath] = tiddler; 
    }
    
    // Find the tiddler title entry corresponding to the delted tiddler filename in $tw.boot.files.
    // This is necessary in case the tiddler filename doesn't match the tiddler title.
    changedTiddlers.deleted.forEach(filepath => {
        
        var tiddlerNameForDeletedFile = pathToTitle[filepath];
        
        // Delete tiddler file info from $tw.boot.files before calling deleteTiddler.
        self.deleteTiddlerFileInfo(tiddlerNameForDeletedFile);
        
        // This deletes the tiddler from the wiki tiddler store, and also
        // enqueus a change event for the syncer to delete the file by calling this class's
        // deleteTiddler method. this.deleteTiddler will only try to delete tiddler from filesystem 
        // if fileInfo is found. Since we already deleted the tiddler fileInfo the call to our 
        // deleteTiddler method does nothing which is what we want since the file is already gone.
        $tw.wiki.deleteTiddler(tiddlerNameForDeletedFile);
        
        // TiddlyWiki client in browser needs the title of each deleted tiddler
        deletedInfo.push({title: tiddlerNameForDeletedFile, file: filepath});
    });
    
    changedTiddlers.new.forEach(filepath => self.loadTiddler({file: filepath}));
    
    changedTiddlers.modified.forEach(filepath => {
        $tw.boot.files[pathToTitle[filepath]].dirty = true;
        self.loadTiddler(pathToTitle[filepath]);
    });
    
    changedTiddlers.deleted = deletedInfo;
    
    return changedTiddlers;
}
    
/*
List only tiddlers that are new, or have been removed from disk.
*/
FileSystemAdaptor.prototype.listNewOrRemoved = function () {
    
    var tiddlerPath = $tw.boot.wikiTiddlersPath;
    var loadedTiddlerFiles = $tw.boot.files;
    
    // Check filesystem for new, deleted, or modified tiddler files
    var tiddlerFilesDetail = this.listTiddlerFiles(tiddlerPath);
    var tiddlersOnDisk = tiddlerFilesDetail.fileNames;
    var fileStats = tiddlerFilesDetail.stats;
            
    var originalFilePaths = [];
    
    // $tw.boot.files maps title to filepath. pathToTitle maps filepath to title
    // to enable looking up a tiddler file's title without needing to read the tiddler file from disk.
    var pathToTitle = {};
    for (var tiddler in loadedTiddlerFiles) {
        pathToTitle[loadedTiddlerFiles[tiddler].filepath] = tiddler; 
    }
   
    
    // If any of the loaded tiddlers is not found in current tiddlersOnDisk
    // it must have been deleted from the disk.
    var deletedFromDisk = [];
    $tw.utils.each(loadedTiddlerFiles, file => {
        originalFilePaths.push(file.filepath);
        if (!tiddlersOnDisk.includes(file.filepath)) {
            deletedFromDisk.push(file.filepath);
        }
    });
    
    // If any of the current tiddlersOnDisk are not in the loaded tiddler files
    // they must have been added after the tiddlywiki server started up.
    var newOnDisk = [];
    tiddlersOnDisk.forEach(file => {
        if (!originalFilePaths.includes(file)) {
            newOnDisk.push(file);
        }
    });
    
    // If the modification time of a tiddler on disk is more recent than the
    // last modification time recorded in $tw.boot.files, it must have been modified
    // on disk outside of tiddlywiki. The last modification time is kept up to date by
    // the saveTiddler method.
    var modifiedOnDisk = [];
    tiddlersOnDisk.forEach(file => {
        
       // If the file is new on disk then skip checking if it's an existing file that was modified.
       if (newOnDisk.includes(file)) {
           return;
       }
        
       var title = pathToTitle[file]; 
       var tiddlerMTimeAtBoot = loadedTiddlerFiles[title].mtime;
       var fileMTime = fileStats[file].mtimeMs;
        
       if (fileMTime > tiddlerMTimeAtBoot) {
           modifiedOnDisk.push(file);
       }
        
    });
    
    return {new: newOnDisk, deleted: deletedFromDisk, modified: modifiedOnDisk};
};

/*
Rescan the tiddler folder and collect all file names along with relative paths.
*/
FileSystemAdaptor.prototype.listTiddlerFiles = function(folderPath) {
    var self = this;
    var tiddlerFilesDetail = {fileNames: [], stats: {}};
    
    // List all files in the folder
    var files = fs.readdirSync(folderPath);
    
    
    // For each file, store file name and stat details. For sub directories
    // recusively enter and store file details.
    $tw.utils.each(files, function(file) {
        
        var stat = fs.statSync(path.resolve(folderPath, file));
        if (stat.isDirectory()) {
            var subDirectoryDetail = self.listTiddlerFiles(path.resolve(folderPath, file));
            // Append sub directory fileNames to array
            tiddlerFilesDetail.fileNames = tiddlerFilesDetail.fileNames.concat(subDirectoryDetail.fileNames);
            // Copy sub directory file stats
            for (var filePath in subDirectoryDetail.stats) { tiddlerFilesDetail.stats[filePath] = subDirectoryDetail.stats[filePath]; }
        }
                                  
        if (stat.isFile() && !file.endsWith(".meta")) {
            tiddlerFilesDetail.fileNames.push(path.resolve(folderPath, file));
            tiddlerFilesDetail.stats[path.resolve(folderPath, file)] = stat;
        }
        
    });
    return tiddlerFilesDetail;
};
    
 /*
    // Load missing tiddlers
    $tw.utils.each(tiddlerFiles, function(filepath) {
        var relativePath = filepath.replace($tw.boot.wikiTiddlersPath + "/", "");
        if (originalFilePaths.fields.text.indexOf(relativePath) == -1) {
            console.log(filepath);
            var tiddlerFile = $tw.loadTiddlersFromFile(filepath,{title: filepath});
            if(tiddlerFile.filepath) {
                $tw.utils.each(tiddlerFile.tiddlers,function(tiddler) {
                    $tw.boot.files[tiddler.title] = {
                       filepath: tiddlerFile.filepath,
                       type: tiddlerFile.type,
                       hasMetaFile: tiddlerFile.hasMetaFile
                    };
                });
            }
            $tw.wiki.addTiddlers(tiddlerFile.tiddlers);
        }
    })
    */
    

if(fs) {
	exports.adaptorClass = FileSystemAdaptor;
}

})();
