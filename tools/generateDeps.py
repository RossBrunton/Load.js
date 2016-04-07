#!/usr/bin/python

# Generates a dependancy file

# > generateDeps.py [path] [obj] [indent]
# Path is the path to (recursivley) generate dependancies for, defaults to the current directory
# Obj will be merged with the dependancies, and any properties on it will be present in the exported file.
# Indent is the amount to indent (an integer) for pretty printing,
#  if not specified then the file will be compressed as much as possible

import sys
import os
import posixpath
import re
import json

TYPE_PACK = 0;
TYPE_RES = 1;

reqPatt = re.compile("load\.require\(\"(.*?)\"(?:,.*)?\)")
reqRPatt = re.compile("load\.requireResource\(\"(.*?)\"(?:,.*)?\)")
provPatt = re.compile("load\.provide\(\"(.*?)\"")
provRPatt = re.compile("load\.provideResource\(\"(.*?)\"")
data = []

if len(sys.argv) > 1:
	os.chdir(sys.argv[1])

def addPack(path, size, type):
	obj = [path, [], [], 0, type]
	data.append(obj)
	
	return obj;

for root, dirs, files in os.walk("."):
	for f in files:
		if f[-3:] == ".js":
			with open(os.path.join(root, f)) as reader:
				pack = addPack(posixpath.join(root, f)[2:], os.path.getsize(os.path.join(root, f)), TYPE_PACK)
				
				for line in reader:
					for match in provPatt.finditer(line):
						if match.group(1) not in data[-1][1]:
							pack[1].append(match.group(1))
					
					for match in provRPatt.finditer(line):
						if match.group(1) not in data[-1][1]:
							pack[1].append(match.group(1))
					
					for match in reqPatt.finditer(line):
						if match.group(1) not in data[-1][2]:
							pack[2].append(match.group(1))
					
					for match in reqRPatt.finditer(line):
						if match.group(1) not in data[-1][2]:
							res = addPack(match.group(1), 0, TYPE_RES)
							res[1] = [match.group(1)]
							pack[2].append(match.group(1))
							
				
				pack[1].sort()
				pack[2].sort()

export = {"version":1, "packages":data}
if len(sys.argv) >= 3:
	export.update(json.loads(sys.argv[2]))

if len(sys.argv) > 3:
	print json.dumps(export, indent=int(sys.argv[3]))
else:
	print json.dumps(export, separators=(',', ':'))
