#!/usr/bin/python

from load import LoadState, LoadHandler
from sys import argv

ls = LoadState(noisy=True)

ls.lie("../tests/deps.json", argv[1])
