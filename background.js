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
const getImageBitSize = src => {
  return new Promise(async resolve => {
    const cache = srcBitSizeMap.get(src)
    if (cache !== undefined) resolve(cache)

    setTimeout(() => resolve(0), 5000)
    try {
      const res = await fetch(src, {method: 'HEAD'})
      if (res.ok) {
        const type = res.headers.get('Content-Type')
        const length = res.headers.get('Content-Length')
        if (type?.startsWith('image')) {
          const size = parseInt(length) || 0
          srcBitSizeMap.set(src, size)
          expired.push(src)
          resolve(size)
        }
      }
    } catch (error) {}

    resolve(0)
  })
}
const getRedirectUrl = async srcList => {
  const asyncList = srcList.map(async src => {
    try {
      const res = await fetch(src)
      return res.redirected ? res.url : src
    } catch (error) {}

    return src
  })
  const redirectUrlList = await Promise.all(asyncList)

  return redirectUrlList
}

const srcBitSizeMap = new Map()
const expired = []
setInterval(() => {
  for (const key of expired) {
    srcBitSizeMap.delete(key)
  }
  expired.length = 0
}, 1000 * 60 * 60)

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

let currOptions = null
let currOptionsWithoutSize = null
let lastImageNodeInfo = null

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'update' || details.reason === 'install') {
    chrome.windows.create({url: 'popup.html', type: 'popup'})
  }
})

function resetLocalStorage() {
  chrome.storage.sync.get('options', res => {
    if (res && Object.keys(res).length === 0 && Object.getPrototypeOf(res) === Object.prototype) {
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

      const defaultKeyLength = Object.keys(defaultOptions).length
      const currKeyLength = Object.keys(currOptions).length
      if (defaultKeyLength !== currKeyLength) {
        console.log('New options available.')
        chrome.runtime.openOptionsPage()
      }
    }
  })
}

function addMessageHandler() {
  chrome.runtime.onMessage.addListener((request, sender, _sendResponse) => {
    const type = request.msg || request
    console.log('Received message: ', sender.tab.id, type)

    const sendResponse = (data, display = true) => {
      const msg = ['Send response:    ', sender.tab.id, type]
      if (data && display) msg.push(data)
      console.log(...msg)
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
          console.log(currOptions)
          sendResponse()
        })
        return true
      }
      case 'load_worker': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id, allFrames: true}, files: ['/scripts/activate-worker.js']}, sendResponse)
        return true
      }
      case 'load_utility': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['/scripts/utility.js']}, sendResponse)
        return true
      }
      case 'load_script': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['image-viewer.js']}, sendResponse)
        return true
      }
      case 'extract_frames': {
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
      case 'reset_dom': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, func: () => document.querySelector('.ImageViewerLastDom')?.classList.remove('ImageViewerLastDom')})
        sendResponse()
        return true
      }
      case 'get_info': {
        if (lastImageNodeInfo?.id === sender.tab.id) {
          sendResponse(lastImageNodeInfo)
        } else {
          sendResponse()
        }
        return true
      }
      case 'update_info': {
        lastImageNodeInfo = request.data
        console.log(...lastImageNodeInfo)
        sendResponse()
        lastImageNodeInfo.id = sender.tab.id
        return true
      }
      case 'open_tab': {
        chrome.tabs.create({active: false, index: sender.tab.index + 1, url: request.url}, sendResponse)
        return true
      }
      case 'close_tab': {
        chrome.tabs.remove(sender.tab.id, sendResponse)
        return true
      }
      case 'get_size': {
        getImageBitSize(request.url).then(size => {
          sendResponse(size, false)
          console.log(request.url, size)
        })
        return true
      }
      case 'get_redirect': {
        getRedirectUrl(request.data).then(resultList => sendResponse(resultList))
        return true
      }
    }
  })
}

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
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
    chrome.contextMenus.create({
      id: 'view_last_right_click_image_in_image_viewer',
      title: i18n('view_last_right_click_image_in_image_viewer'),
      contexts: ['action']
    })
  })

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab.url) return
    console.log('Context menus event: ', tab.id, info.menuItemId)
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
      case 'view_last_right_click_image_in_image_viewer': {
        await passDataToTab(tab.id, 'ImageViewerOption', currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-image.js']})
        return
      }
    }
  })
}

function addToolbarIconHandler() {
  chrome.action.onClicked.addListener(async tab => {
    if (!tab.url) return
    await passDataToTab(tab.id, 'ImageViewerOption', currOptions)
    chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
  })
}

function addCommandHandler() {
  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (!tab.url) return
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
