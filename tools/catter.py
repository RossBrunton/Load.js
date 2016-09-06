#!/usr/bin/python

from load import LoadState, LoadHandler
from sys import argv, stdout
from base64 import b64encode

def arr_join(arr):
    return ", ".join(map(lambda x: "\"{}\"".format(x), arr))

class Handler(LoadHandler):
    def load_file(self, state, file, packs, type):
        super(Handler, self).load_file(state, file, packs, type)
        
        stdout.write("/* Including packs: {} */\n".format(", ".join(packs)))
        if type == LoadState.TYPE_PACK:
            deps = state.getDependencies(packs[0])
            
            if "load" not in packs:
                # function(file, provided, required, size, type)
                stdout.write('load.addDependency("about:blank", [{}], [{}], 0, {});\n\n'.format(
                    arr_join(packs), arr_join(deps), LoadState.TYPE_PACK
                ))
            
            with open(file) as f:
                for l in f.readlines():
                    stdout.write(l)
            
            stdout.write("\n")
        
        
        if type == LoadState.TYPE_RES:
            with open(file) as f:
                buff = f.read()
            
            for p in packs:
                stdout.write('load.provideResource("{}", atob("{}"));\n\n'.format(p, b64encode(buff)))
        
        
        if type == LoadState.TYPE_EXT:
            for p in packs:
                deps = state.getDependencies(p)
                
                # function(file, provided, required, size, type)
                stdout.write('load.addDependency("{}", [\"{}\"], [{}], 0, {});\n\n'.format(
                    file, p, arr_join(deps), LoadState.TYPE_EXT
                ))
            
    
    """ Evaluate a single package """
    def evaluate(self, state, pack, type):
        super(Handler, self).evaluate(state, pack, type)

if len(argv) != 3:
    print("Usage: catter.py deps.json pack")
    exit(1)

ls = LoadState(handler=Handler())
ls.loadDeps(argv[1])

ls.importAndEvaluate("load")
ls.importAndEvaluate(argv[2])
stdout.write("load.importAndEvaluate(\"{}\");\n".format(argv[2]))
