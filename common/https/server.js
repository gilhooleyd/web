const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const port = process.argv[2] || 9000;

const options = {
  key: fs.readFileSync(__dirname + '/key.pem'),
  cert: fs.readFileSync(__dirname + '/cert.pem')
};


var files = []
var poll_res = []

https.createServer(options, function (req, res) {
  console.log(`${req.method} ${req.url}`);

  // parse URL
  const parsedUrl = url.parse(req.url);
  // extract URL path
  let pathname = `.${parsedUrl.pathname}`;
  console.log(pathname);
  if (pathname == "./hot-reload.js") {
      res.setHeader('Content-type', 'text/javascript');
      res.end(`
function hotReload() {
    fetch("/hot-reload").then(function(response) {
        return response.text();
    }).then(function(data) {
        console.log(data);
        var head = document.getElementsByTagName('head')[0];
        var script= document.createElement('script');
        script.src= data+'?cachebuster='+ new Date().getTime();
        head.appendChild(script);
        hotReload();
    }).catch(function(err) {
        console.log('Fetch Error :-S', err);
    });
}
hotReload();`);
      return;
    }

    if (pathname == "./hot-reload") {
        console.log("Trying to reload!");
    if (files.length != 0) {
    res.setHeader('Content-type', 'text/plain');
    res.end(files.pop());
        return;
    }
    poll_res.push(res);
    return;
  }
  // based on the URL path, extract the file extension. e.g. .js, .doc, ...
  const ext = path.parse(pathname).ext;
  // maps file extension to MIME typere
  const map = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword'
  };

  fs.exists(pathname, function (exist) {
    if(!exist) {
      // if the file is not found, return 404
      res.statusCode = 404;
      res.end(`File ${pathname} not found!`);
      return;
    }

    // if is a directory search for index file matching the extension
    if (fs.statSync(pathname).isDirectory()) pathname += '/index' + ext;

    // read file from file system
    fs.readFile(pathname, function(err, data){
      if(err){
        res.statusCode = 500;
        res.end(`Error getting the file: ${err}.`);
      } else {
        // if the file is found, set Content-type and send data
        res.setHeader('Content-type', map[ext] || 'text/plain' );
        res.end(data);
      }
    });
  });


}).listen(parseInt(port));

fs.watch('./', (eventType, filename) => {
    console.log(`File ${eventType}: ${filename}`);
    res = poll_res.pop();
    if (res) {
        console.log(`Had req!`);
        res.setHeader('Content-type', 'text/plain');
        res.end(filename);
    } else {
        files.push(filename);
    }
})

console.log(`Server listening on http://localhost:${port}`);
