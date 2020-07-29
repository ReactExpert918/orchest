export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function nameToFilename(name){
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export function makeCancelable(promise){
  let hasCanceled_ = false;

  const wrappedPromise = new Promise((resolve, reject) => {
    promise.then(
      val => hasCanceled_ ? reject({isCanceled: true}) : resolve(val),
      error => hasCanceled_ ? reject({isCanceled: true}) : reject(error)
    );
  });

  return {
    promise: wrappedPromise,
    cancel() {
      hasCanceled_ = true;
    },
  };
};

export function extensionFromFilename(filename){
  if(filename.indexOf(".") === -1){
    return "";
  }
  let pieces = filename.split(".");
  return pieces[pieces.length-1];
}

export function filenameWithoutExtension(filename){
  let pieces = filename.split(".");
  return pieces.slice(0, pieces.length - 1).join(".");
}

export function intersectRect(r1, r2) {
  return !(r2.x > r1.x + r1.width || 
           r2.x + r2.width < r1.x || 
           r2.y > r1.y + r1.height ||
           r2.y + r2.height < r1.y);
}

export function makeRequest(method, url, body) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url);

    xhr.timeout = 120 * 1000; // 120 second timeout

    xhr.setRequestHeader('Cache-Control', 'no-cache, must-revalidate, post-check=0, pre-check=0');
    
    if(body !== undefined && body.type === "json"){
      xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    }

    xhr.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        resolve(xhr.response);
      } else {
        reject({
          status: this.status,
          statusText: xhr.statusText,
          body: xhr.response
        });
      }
    };
    xhr.onerror = function () {
      reject({
        status: this.status,
        statusText: xhr.statusText,
        body: xhr.response
      });
    };

    xhr.ontimeout = function(){
      console.log("Request timed out.")
      reject({
        status: this.status,
        statusText: xhr.statusText,
        body: xhr.response
      })
    }

    if(body !== undefined){
      if(body.type === "json"){
        xhr.send(JSON.stringify(body.content));
      }else{
        xhr.send(body.content);
      }
    }else{
      xhr.send();
    }
  });
}


export function nodeCenter(el) {

  let position = {};

  position.x = el.offset().left + el.width() / 2;
  position.y = el.offset().top + el.height() / 2;

  return position;
}

export function correctedPosition(x, y, el) {
  let elementOffset = el.offset();
  let position = {};
  position.x = x - elementOffset.left;
  position.y = y - elementOffset.top;
  return position;
}


export function globalMDCVars(){
  return {
    mdcthemeprimary: "#000000",
    mdcthemesecondary: "#0a6df7",
    mdcthemebackground: "#fff",
  };
}