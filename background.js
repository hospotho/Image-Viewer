const i18n = tag => chrome.i18n.getMessage(tag)
const passDataToTab = (id, name, data) => {
  console.log('Pass data: ', id, name, data)
  return chrome.scripting.executeScript({
    args: [data, name],
    target: {tabId: id, allFrames: true},
    func: (data, name) => {
      window[name] = data
    }
  })
}

let currOptions = null
let currOptionsWithoutSize = null
let lastImageNodeInfo = null

function resetLocalStorage() {
  chrome.storage.sync.get('options', res => {
    if (res && Object.keys(res).length === 0 && Object.getPrototypeOf(res) === Object.prototype) {
      const defaultOptions = {
        fitMode: 'both',
        zoomRatio: 1.2,
        rotateDeg: 15,
        minWidth: 150,
        minHeight: 150,
        svgFilter: true,
        debouncePeriod: 1500,
        throttlePeriod: 80,
        hotkey: ['Shift + Q', 'Shift + W', 'Shift + E', 'Shift + R', 'Ctrl + Alt + Q', ''],
        customUrl: ['https://example.com/search?query={imgSrc}&option=example_option']
      }
      chrome.storage.sync.set({options: defaultOptions}, () => {
        console.log('Set options to default values.')
        console.log(defaultOptions)
      })
      currOptions = defaultOptions
      currOptionsWithoutSize = Object.assign({}, currOptions)
      currOptionsWithoutSize.minWidth = 0
      currOptionsWithoutSize.minHeight = 0
      chrome.runtime.openOptionsPage()
    } else {
      currOptions = res.options
      currOptionsWithoutSize = Object.assign({}, currOptions)
      currOptionsWithoutSize.minWidth = 0
      currOptionsWithoutSize.minHeight = 0
      console.log('Loaded options from storage.')
      console.log(res.options)
    }
  })
}

function addMessageHandler() {
  chrome.runtime.onMessage.addListener((request, sender, _sendResponse) => {
    const type = request.msg || request
    console.log('Received message: ', sender.tab.id, type)

    const sendResponse = data => {
      if (data) console.log('Send response: ', sender.tab.id, type, data)
      _sendResponse(data)
    }
    switch (type) {
      case 'get_options': {
        sendResponse(currOptions)
        return true
      }
      case 'update_options': {
        chrome.storage.sync.get('options', res => {
          currOptions = res.options
          currOptionsWithoutSize = Object.assign({}, currOptions)
          currOptionsWithoutSize.minWidth = 0
          currOptionsWithoutSize.minHeight = 0
          console.log('New options: ', currOptions)
          sendResponse()
        })
        return true
      }
      case 'load_worker': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id, allFrames: true}, files: ['/scripts/activate-worker.js']}, () => sendResponse())
        return true
      }
      case 'load_utility': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['/scripts/utility.js']}, () => sendResponse())
        return true
      }
      case 'load_script': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['image-viewer.js']}, () => sendResponse())
        return true
      }
      case 'load_frames': {
        const newOptions = Object.assign({}, currOptions)
        newOptions.minWidth = request.minSize
        newOptions.minHeight = request.minSize
        passDataToTab(sender.tab.id, 'ImageViewerOption', newOptions)
        chrome.scripting.executeScript({target: {tabId: sender.tab.id, allFrames: true}, files: ['/scripts/extract-iframe.js']}, results => {
          let args = []
          for (const result of results) {
            if (!result.result) continue
            args.push(...result.result)
          }
          sendResponse(args)
        })
        return true
      }
      case 'get_info': {
        sendResponse(lastImageNodeInfo)
        return true
      }
      case 'update_info': {
        lastImageNodeInfo = request.data
        console.log('New info: ', lastImageNodeInfo)
        sendResponse()
        return true
      }
      case 'open_tab': {
        chrome.tabs.create({active: false, index: sender.tab.index + 1, url: request.url}, () => sendResponse())
        return true
      }
    }
  })
}

function createContextMenu() {
  chrome.contextMenus.create({
    id: 'view_images_in_image_viewer',
    title: i18n('view_images_in_image_viewer'),
    contexts: ['all']
  })
  chrome.contextMenus.create({
    id: 'view_all_image_in_image_viewer',
    title: i18n('view_all_images_in_image_viewer'),
    contexts: ['action']
  })

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    console.log(info.menuItemId)
    switch (info.menuItemId) {
      case 'view_images_in_image_viewer': {
        await passDataToTab(tab.id, 'ImageViewerOption', currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-image.js']})
        return
      }
      case 'view_all_image_in_image_viewer': {
        passDataToTab(tab.id, 'ImageViewerOption', currOptionsWithoutSize)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
        return
      }
    }
  })
}

function addToolbarIconHandler() {
  chrome.action.onClicked.addListener(async tab => {
    await passDataToTab(tab.id, 'ImageViewerOption', currOptions)
    chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
  })
}

function addCommandHandler() {
  chrome.commands.onCommand.addListener(async (command, tab) => {
    switch (command) {
      case 'open-image-viewer': {
        await passDataToTab(tab.id, 'ImageViewerOption', currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
        return
      }
      case 'open-image-viewer-without-size-filter': {
        passDataToTab(tab.id, 'ImageViewerOption', currOptionsWithoutSize)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
        return
      }
    }
  })
}

function init() {
  resetLocalStorage()
  addMessageHandler()
  createContextMenu()
  addToolbarIconHandler()
  addCommandHandler()
  console.log('Init complete.')
}

init()
