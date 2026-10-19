'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitdeck', {
  invoke: (channel, payload) => {
    if (typeof channel !== 'string' || channel.indexOf('gd:') !== 0) {
      return Promise.resolve({ ok: false, error: 'Channel not allowed' });
    }
    return ipcRenderer.invoke(channel, payload);
  },
});
