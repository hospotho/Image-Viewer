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
  const cache = srcBitSizeMap.get(src)
  if (cache !== undefined) return cache

  return new Promise(async _resolve => {
    const resolve = size => {
      srcBitSizeMap.set(src, size)
      _resolve(size)
    }
    setTimeout(() => resolve(0), 5000)

    try {
      const res = await fetch(src, {method: 'HEAD'})
      if (res.ok) {
        const type = res.headers.get('Content-Type')
        const length = res.headers.get('Content-Length')
        if (type?.startsWith('image')) {
          const size = Number(length) || 0
          resolve(size)
        }
      }
    } catch (error) {}

    resolve(0)
  })
}
const getImageLocalRealSize = (id, srcUrl) => {
  const cache = srcLocalRealSizeMap.get(srcUrl)
  if (cache !== undefined) return cache

  return new Promise(_resolve => {
    const resolve = size => {
      srcLocalRealSizeMap.set(srcUrl, size)
      _resolve(size)
    }

    const listener = (request, sender, sendResponse) => {
      if (request.msg === 'reply' && sender.tab.id === id) {
        sendResponse()
        chrome.runtime.onMessage.removeListener(listener)
        resolve(request.size)
        return true
      }
    }
    chrome.runtime.onMessage.addListener(listener)

    chrome.scripting.executeScript({
      args: [srcUrl],
      target: {tabId: id},
      func: srcUrl => {
        const img = new Image()
        img.onload = () => chrome.runtime.sendMessage({msg: 'reply', size: img.naturalWidth})
        img.onerror = () => chrome.runtime.sendMessage({msg: 'reply', size: 0})
        img.src = srcUrl
      }
    })
  })
}
const getRedirectUrl = async srcList => {
  const asyncList = srcList.map(async src => {
    if (src === '' || src === 'about:blank') return src

    try {
      const res = await fetch(src)
      return res.redirected ? res.url : src
    } catch (error) {}

    return src
  })
  const redirectUrlList = await Promise.all(asyncList)

  return redirectUrlList
}
const checkIframeUrl = (url, complete = false) => {
  return new Promise(async _resolve => {
    const resolve = bool => {
      _resolve(bool)
      clearTimeout(timeout)
    }
    const timeout = setTimeout(() => resolve(false), 3000)
    try {
      // default second parameter is index from array.map
      const option = complete === true ? {method: 'GET'} : {method: 'HEAD'}
      const res = await fetch(url, option)
      if (res.ok) {
        const options = res.headers.get('X-Frame-Options')?.toUpperCase()
        if (!options) {
          resolve(true)
        } else if (options === 'DENY') {
          resolve(false)
        } else if (options === 'SAMEORIGIN') {
          const target = new URL(res.url).origin
          const origin = new URL(sender.tab.url).origin
          resolve(target === origin)
        }
      } else {
        const policy = res.headers.get('referrer-policy')
        if (policy === 'strict-origin-when-cross-origin') {
          console.log('CORS error, assuming iframe url is valid', url)
          resolve(true)
        }
        const type = res.headers.get('content-type')
        if (type?.startsWith?.('text/html')) {
          console.log(`${res.status} error but correct type. Testing GET method`, url)
          resolve(checkIframeUrl(url, true))
        }
      }
    } catch (error) {}
    resolve(false)
  })
}
const resetLabel = () => document.querySelector('.ImageViewerLastDom')?.classList.remove('ImageViewerLastDom')

const srcBitSizeMap = new Map()
const srcLocalRealSizeMap = new Map()

const defaultOptions = {
  fitMode: 'both',
  zoomRatio: 1.2,
  rotateDeg: 15,
  minWidth: 180,
  minHeight: 150,
  svgFilter: true,
  debouncePeriod: 1500,
  throttlePeriod: 80,
  searchHotkey: ['Shift + Q', 'Shift + W', 'Shift + A', 'Shift + S', 'Ctrl + Shift + Q', ''],
  customUrl: ['https://example.com/search?query={imgSrc}&option=example_option'],
  functionHotkey: ['Shift + R', 'Shift + D'],
  hoverCheckDisableList: [],
  autoScrollEnableList: ['twitter.com', 'instagram.com', 'facebook.com']
}

let currOptions = null
let currOptionsWithoutSize = null
let lastImageNodeInfo = null
let lastTabID = 0
let lastTabIndex = 0
let lastTabOpenIndex = 0

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
        ;(async () => {
          await passDataToTab(sender.tab.id, 'ImageViewerOption', currOptions)
          sendResponse()
        })()
        return true
      }
      case 'update_options': {
        ;(async () => {
          const res = await chrome.storage.sync.get('options')
          currOptions = res.options
          currOptionsWithoutSize = Object.assign({}, currOptions)
          currOptionsWithoutSize.minWidth = 0
          currOptionsWithoutSize.minHeight = 0
          console.log(currOptions)
          sendResponse()
        })()
        return true
      }
      case 'load_worker': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id, allFrames: true}, files: ['/scripts/activate-worker.js']}, () => sendResponse())
        return true
      }
      case 'load_main_worker': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['/scripts/activate-worker.js']}, () => sendResponse())
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
      case 'check_iframes': {
        ;(async () => {
          const iframeUrlList = request.data
          const asyncList = iframeUrlList.map(checkIframeUrl)
          const result = await Promise.all(asyncList)
          sendResponse(result, false)
        })()
        return true
      }
      case 'extract_frames': {
        ;(async () => {
          const newOptions = Object.assign({}, currOptions)
          newOptions.minWidth = request.minSize
          newOptions.minHeight = request.minSize
          await passDataToTab(sender.tab.id, 'ImageViewerOption', newOptions)
          const results = await chrome.scripting.executeScript({target: {tabId: sender.tab.id, allFrames: true}, files: ['/scripts/extract-iframe.js']})

          const relation = new Map()
          const imageDataList = []
          for (const result of results) {
            if (!result.result) continue
            const [href, subHrefList, imageList] = result.result
            for (const subHref of subHrefList) {
              relation.set(subHref, href)
            }
            imageDataList.push([imageList, href])
          }

          const args = []
          for (const [imageList, href] of imageDataList) {
            let top = href
            while (relation.has(top)) top = relation.get(top)
            for (const image of imageList) {
              args.push([image, top])
            }
          }
          sendResponse(args)
        })()
        return true
      }
      case 'reset_dom': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, func: resetLabel}, sendResponse)
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
        if (lastTabID !== sender.tab.id || lastTabIndex !== sender.tab.index) {
          lastTabID = sender.tab.id
          lastTabIndex = sender.tab.index
          lastTabOpenIndex = sender.tab.index
        }
        chrome.tabs.create({active: false, index: ++lastTabOpenIndex, url: request.url}, sendResponse)
        return true
      }
      case 'close_tab': {
        chrome.tabs.remove(sender.tab.id, sendResponse)
        return true
      }
      case 'get_size': {
        ;(async () => {
          const size = await getImageBitSize(request.url)
          sendResponse(size, false)
          console.log(request.url, size)
        })()
        return true
      }
      case 'get_local_size': {
        ;(async () => {
          const size = await getImageLocalRealSize(sender.tab.id, request.url)
          sendResponse(size, false)
          console.log(request.url, size)
        })()
        return true
      }
      case 'get_redirect': {
        ;(async () => {
          const resultList = await getRedirectUrl(request.data)
          sendResponse(resultList)
        })()
        return true
      }
      case 'download_images': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['/scripts/download-images.js']}, sendResponse)
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
        await passDataToTab(tab.id, 'ImageViewerOption', currOptionsWithoutSize)
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
        await passDataToTab(tab.id, 'ImageViewerOption', currOptionsWithoutSize)
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
