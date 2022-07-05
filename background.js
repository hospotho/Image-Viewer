;(function () {
  'use strict'

  const i18n = tag => chrome.i18n.getMessage(tag)
  var args = []

  function resetLocalStorage() {
    chrome.storage.sync.get('options', res => {
      if (res && Object.keys(res).length === 0 && Object.getPrototypeOf(res) === Object.prototype) {
        const defaultOptions = {fitMode: 'both', zoomRatio: 1.5, rotateDeg: 15, minWidth: 100, minHeight: 100}
        chrome.storage.sync.set({options: defaultOptions}, () => {
          console.log('Set options to default values.')
        })
        chrome.runtime.openOptionsPage()
        return
      }
      console.log('Init comolete.')
      console.log(res)
    })
  }

  function addMessageHandler() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request === 'get_options') {
        chrome.storage.sync.get('options', res => sendResponse(res))
        return true
      }
      if (request === 'load_script') {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['image-viewer.js']}, res => sendResponse({}))
        return true
      }
      if (request === 'get_args') {
        sendResponse(args)
        args = []
        return true
      }
    })
  }

  function createContextMenu() {
    chrome.contextMenus.removeAll()
    chrome.contextMenus.create({
      id: 'open_in_image_viewer',
      title: i18n('open_in_image_viewer'),
      contexts: ['image']
    })
    chrome.contextMenus.create({
      id: 'open_image_viewer',
      title: i18n('view_images_in_image_viewer'),
      contexts: ['page']
    })
    chrome.contextMenus.create({
      id: 'open_all_image_in_image_viewer',
      title: i18n('view_all_images_in_image_viewer'),
      contexts: ['action']
    })

    chrome.contextMenus.onClicked.addListener((info, tab) => {
      switch (info.menuItemId) {
        case 'open_in_image_viewer':
          args.push(info.srcUrl)
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-image.js']})
          break
        case 'open_image_viewer':
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
          break
        case 'open_all_image_in_image_viewer':
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-all.js']})
          break
      }
    })
  }

  function addTooltipdHandler() {
    chrome.action.onClicked.addListener(tab => {
      chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
    })
  }

  function addCommandHandler() {
    chrome.commands.onCommand.addListener((command, tab) => {
      switch (command) {
        case 'open-image-viewer':
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
          break
        case 'open-image-viewer-without-size-filter':
          chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-all.js']})
          break
      }
    })
  }

  function init() {
    resetLocalStorage()
    addMessageHandler()
    createContextMenu()
    addTooltipdHandler()
    addCommandHandler()
  }

  init()
})()
