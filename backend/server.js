const express = require('express');
const cors = require('cors');
const compression = require('compression');
const db = require('./database');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const execPromise = util.promisify(exec);

const app = express();

// 
