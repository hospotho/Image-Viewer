// utility function
const srcBitSizeMap = new Map()
const srcLocalRealSizeMap = new Map()
const srcLocalRealSizeResolveMap = new Map()
const srcDataUrlMap = new Map()
const redirectUrlMap = new Map()
const semaphore = (() => {
  // parallel fetch
  let activeCount = 0
  const maxConcurrent = 32
  const queue = []
  return {
    acquire: function () {
      let executed = false
      const release = () => {
        if (executed) return
        executed = true
        activeCount--
        const grantAccess = queue.shift()
        if (grantAccess) grantAccess()
      }

      if (activeCount < maxConcurrent) {
        activeCount++
        return release
      }
      const {promise, resolve} = Promise.withResolvers()
      const grantAccess = () => {
        activeCount++
        resolve(release)
      }
      queue.push(grantAccess)
      return promise
    }
  }
})()

const i18n = tag => chrome.i18n.getMessage(tag)
const oldExecuteScript = chrome.scripting.executeScript
chrome.scripting.executeScript = async function () {
  try {
    const result = await oldExecuteScript.apply(this, arguments)
    return result
  } catch (error) {
    return error
  }
}

function passOptionToTab(id, option) {
  return chrome.scripting.executeScript({
    args: [option],
    target: {tabId: id},
    func: option => {
      window.ImageViewerOption = option
    }
  })
}

async function fetchBitSize(src, useGetMethod = false) {
  const release = await semaphore.acquire()
  const method = useGetMethod ? 'GET' : 'HEAD'
  try {
    const res = await fetch(src, {method: method, signal: AbortSignal.timeout(5000)})
    if (!res.ok) {
      return !useGetMethod ? fetchBitSize(src, true) : 0
    }

    if (res.redirected) {
      const originalPath = new URL(src).pathname
      const newPath = new URL(res.url).pathname
      if (originalPath !== newPath) return 0
    }

    const type = res.headers.get('Content-Type')
    if (!type?.startsWith('image')) {
      return !useGetMethod ? fetchBitSize(src, true) : 0
    }

    const length = res.headers.get('Content-Length')
    const size = Number(length)
    // some server return strange content length for HEAD method
    if (size < 100 && !useGetMethod) {
      return fetchBitSize(src, true)
    }
    return size
  } catch (error) {
    return 0
  } finally {
    release()
  }
}
async function getImageBitSize(src) {
  const cache = srcBitSizeMap.get(src)
  if (cache !== undefined) return cache

  const promise = fetchBitSize(src)
  srcBitSizeMap.set(src, promise)
  return promise
}
async function getImageLocalRealSize(id, src) {
  const cache = srcLocalRealSizeMap.get(src)
  if (cache !== undefined) return cache

  const release = await semaphore.acquire()
  const promise = new Promise(_resolve => {
    const resolve = size => {
      srcLocalRealSizeMap.set(src, size)
      _resolve(size)
      release()
    }
    srcLocalRealSizeResolveMap.set(src, resolve)

    chrome.scripting.executeScript({
      args: [src],
      target: {tabId: id},
      func: src => {
        const img = new Image()
        img.onload = () => chrome.runtime.sendMessage({msg: 'reply_local_size', src: src, size: img.naturalWidth})
        img.onerror = () => chrome.runtime.sendMessage({msg: 'reply_local_size', src: src, size: 0})
        setTimeout(() => img.complete || chrome.runtime.sendMessage({msg: 'reply_local_size', src: src, size: 0}), 10000)
        img.src = src
      }
    })
  })

  srcLocalRealSizeMap.set(src, promise)
  return promise
}
async function fetchDataUrl(src) {
  const release = await semaphore.acquire()
  try {
    const res = await fetch(src, {signal: AbortSignal.timeout(10000)})
    const blob = await res.blob()
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target.result)
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.log(`Failed to load ${src}`)
    return ''
  } finally {
    release()
  }
}
async function getDataUrl(src) {
  const cache = srcDataUrlMap.get(src)
  if (cache !== undefined) return cache

  const promise = fetchDataUrl(src)
  srcDataUrlMap.set(src, promise)
  return promise
}
async function getLocalUrl(tabId, src) {
  if (src.startsWith('data:')) return src
  const size = await getImageLocalRealSize(tabId, src)
  if (size) return src
  const dataUrl = await getDataUrl(src)
  return dataUrl
}
async function getRedirectUrl(urlList) {
  const asyncList = urlList.map(async url => {
    if (url === '' || url === 'about:blank') return url

    const cache = redirectUrlMap.get(url)
    if (cache !== undefined) return cache

    try {
      const res = await fetch(url)
      const finalUrl = res.redirected ? res.url : url
      redirectUrlMap.set(url, finalUrl)
      return finalUrl
    } catch (error) {}

    redirectUrlMap.set(url, url)
    return url
  })
  const redirectUrlList = await Promise.all(asyncList)
  return redirectUrlList
}

// main function
const defaultOptions = {
  fitMode: 'both',
  zoomRatio: 1.2,
  rotateDeg: 15,
  minWidth: 180,
  minHeight: 150,
  svgFilter: true,
  debouncePeriod: 1500,
  throttlePeriod: 80,
  autoPeriod: 2000,
  searchHotkey: ['Shift + Q', 'Shift + W', 'Shift + A', 'Shift + S', 'Ctrl + Shift + Q', ''],
  customUrl: ['https://example.com/search?query={imgSrc}&option=example_option'],
  functionHotkey: ['Shift + R', 'Shift + D'],
  hoverCheckDisableList: [],
  autoScrollEnableList: ['x.com', 'www.instagram.com', 'www.facebook.com'],
  imageUnlazyDisableList: []
}

let currOptions = defaultOptions
let currOptionsWithoutSize = defaultOptions
let lastImageNodeInfo = ['', 0]
let lastImageNodeInfoID = 0
let lastTabID = 0
let lastTabIndex = 0
let lastTabOpenIndex = 0

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'update' || details.reason === 'install') {
    chrome.windows.create({url: '/page/popup.html', type: 'popup'})
  }
})

function resetLocalStorage() {
  chrome.storage.sync.get('options', res => {
    if (res && Object.keys(res).length === 0 && Object.getPrototypeOf(res) === Object.prototype) {
      chrome.storage.sync.set({options: defaultOptions}, () => {
        console.log('Set options to default options')
        console.log(defaultOptions)
      })
      chrome.runtime.openOptionsPage()
    } else {
      currOptions = res.options
      console.log('Loaded options from storage')
      console.log(res.options)

      const existNewOptions = Object.keys(defaultOptions).some(key => key in currOptions === false)
      if (existNewOptions) {
        console.log('New options available')
        chrome.runtime.openOptionsPage()
      }
    }
    currOptionsWithoutSize = Object.assign({}, currOptions)
    currOptionsWithoutSize.minWidth = 0
    currOptionsWithoutSize.minHeight = 0
  })
}

function addMessageHandler() {
  chrome.runtime.onMessage.addListener((request, sender, _sendResponse) => {
    if (!sender.tab) return

    const type = request.msg || request
    console.log('Messages: ', sender.tab.id, type)

    const sendResponse = (data = null, display = true) => {
      const msg = ['Response: ', sender.tab.id, type]
      if (data && display) msg.push(data)
      console.log(...msg)
      _sendResponse(data)
    }

    switch (type) {
      // option
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
      // init
      case 'get_options': {
        ;(async () => {
          await chrome.scripting.executeScript({
            args: [currOptions],
            target: {tabId: sender.tab.id, frameIds: [sender.frameId]},
            func: option => (window.ImageViewerOption = option)
          })
          sendResponse()
        })()
        return true
      }
      case 'load_worker': {
        ;(async () => {
          await chrome.scripting.executeScript({target: {tabId: sender.tab.id, frameIds: [sender.frameId]}, files: ['/scripts/activate-worker.js']})
          sendResponse()
        })()
        return true
      }
      case 'load_extractor': {
        ;(async () => {
          await chrome.scripting.executeScript({target: {tabId: sender.tab.id, frameIds: [sender.frameId]}, files: ['/scripts/extract-iframe.js']})
          sendResponse()
        })()
        return true
      }
      case 'load_utility': {
        ;(async () => {
          await chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['/scripts/utility.js']})
          await chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['image-viewer.js']})
          sendResponse()
        })()
        return true
      }
      case 'load_script': {
        ;(async () => {
          await chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['image-viewer.js']})
          sendResponse()
        })()
        return true
      }
      // worker
      case 'reset_dom': {
        ;(async () => {
          await chrome.scripting.executeScript({
            target: {tabId: sender.tab.id},
            func: () => (window.ImageViewerLastDom = null)
          })
          sendResponse()
        })()
        return true
      }
      case 'update_info': {
        ;(async () => {
          lastImageNodeInfo = request.data
          lastImageNodeInfoID = sender.tab.id
          // get data url if CORS
          if (sender.tab.url !== sender.url) {
            lastImageNodeInfo[0] = await getLocalUrl(sender.tab.id, lastImageNodeInfo[0])
          }
          // image size maybe decreased in dataURL
          lastImageNodeInfo[1] -= 3
          console.table(lastImageNodeInfo)
          sendResponse()
        })()
        return true
      }
      case 'get_info': {
        if (lastImageNodeInfoID === sender.tab.id) {
          sendResponse(lastImageNodeInfo)
        } else {
          sendResponse()
        }
        return true
      }
      case 'reply_local_size': {
        const resolve = srcLocalRealSizeResolveMap.get(request.src)
        if (resolve) {
          resolve(request.size)
          srcLocalRealSizeResolveMap.delete(request.src)
        }
        sendResponse()
        return true
      }
      // utility
      case 'get_size': {
        ;(async () => {
          const size = await getImageBitSize(request.url)
          sendResponse(size, false)
          console.log(request.url, size)
        })()
        return true
      }
      case 'extract_frames': {
        ;(async () => {
          const newOptions = Object.assign({}, currOptions)
          newOptions.minWidth = request.minSize
          newOptions.minHeight = request.minSize
          if (request.canvasMode) newOptions.canvasMode = true

          // must use frameIds, allFrames: true wont works in most cases
          const frameList = await chrome.webNavigation.getAllFrames({tabId: sender.tab.id})
          if (frameList === null || frameList.length < 2) {
            sendResponse([])
          }
          const iframeList = frameList.slice(1)
          const results = await chrome.scripting.executeScript({
            args: [newOptions],
            target: {tabId: sender.tab.id, frameIds: iframeList.map(frame => frame.frameId)},
            func: async option => await window.ImageViewerExtractor?.extractImage(option)
          })
          if (results instanceof Error) {
            sendResponse([])
            return
          }

          const relation = new Map()
          const pageDataList = []
          for (const result of results) {
            if (!result.result) continue
            const [href, subHrefList, imageList] = result.result
            const localImageList = Promise.all(imageList.map(src => getLocalUrl(sender.tab.id, src)))
            for (const subHref of subHrefList) {
              if (subHref !== href) relation.set(subHref, href)
            }
            pageDataList.push([localImageList, href])
          }

          const result = []
          for (const [imageList, href] of pageDataList) {
            let top = href
            while (relation.has(top)) top = relation.get(top)
            for (const image of await imageList) {
              result.push([image, top])
            }
          }
          sendResponse(result)
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
      // image viewer
      case 'open_tab': {
        if (lastTabID !== sender.tab.id || lastTabIndex !== sender.tab.index) {
          lastTabID = sender.tab.id
          lastTabIndex = sender.tab.index
          lastTabOpenIndex = sender.tab.index
        }
        chrome.tabs.create({active: false, index: ++lastTabOpenIndex, url: request.url}, () => sendResponse())
        return true
      }
      case 'close_tab': {
        chrome.tabs.remove(sender.tab.id, () => sendResponse())
        return true
      }
      case 'google_search': {
        ;(async () => {
          const blob = await fetch(request.src).then(res => res.blob())
          const arrayBuffer = await blob.arrayBuffer()
          const dataUrl = await new Promise(resolve => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.readAsDataURL(blob)
          })

          const endpoint = 'https://www.google.com/searchbyimage/upload'
          const form = new FormData()
          form.append('encoded_image', new File([arrayBuffer], 'iv-image.jpg', {type: blob.type}))
          form.append('image_url', dataUrl)
          form.append('sbisrc', 'Image Viewer')

          const res = await fetch(endpoint, {method: 'POST', body: form})
          if (!res.ok) return

          if (lastTabID !== sender.tab.id || lastTabIndex !== sender.tab.index) {
            lastTabID = sender.tab.id
            lastTabIndex = sender.tab.index
            lastTabOpenIndex = sender.tab.index
          }
          chrome.tabs.create({active: false, index: ++lastTabOpenIndex, url: res.url}, () => sendResponse())
        })()
        return true
      }
      // download
      case 'download_images': {
        ;(async () => {
          await chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['/scripts/download-images.js']})
          sendResponse()
        })()
        return true
      }
      case 'request_cors_url': {
        ;(async () => {
          const release = await semaphore.acquire()
          const res = await fetch(request.url)
          release()
          const blob = await res.blob()
          const reader = new FileReader()
          const dataUrl = await new Promise(resolve => {
            reader.onload = () => resolve(reader.result)
            reader.readAsDataURL(blob)
          })
          const mime = res.headers.get('content-type').split(';')[0] || 'image/jpeg'
          sendResponse([dataUrl, mime])
        })()
        return true
      }
    }
  })
}

function addToolbarIconHandler() {
  chrome.action.onClicked.addListener(async tab => {
    if (!tab.url) return
    await passOptionToTab(tab.id, currOptions)
    chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
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
    chrome.contextMenus.create({
      id: 'view_canvas_in_image_viewer',
      title: i18n('view_canvas_in_image_viewer'),
      contexts: ['action']
    })
  })

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab.url) return
    const supported = tab.url.startsWith('http') || (tab.url.startsWith('file') && (await chrome.extension.isAllowedFileSchemeAccess()))
    if (!supported) return

    switch (info.menuItemId) {
      case 'view_images_in_image_viewer': {
        await passOptionToTab(tab.id, currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-image.js']})
        break
      }
      case 'view_all_image_in_image_viewer': {
        await passOptionToTab(tab.id, currOptionsWithoutSize)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
        break
      }
      case 'view_last_right_click_image_in_image_viewer': {
        await passOptionToTab(tab.id, currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-image.js']})
        break
      }
      case 'view_canvas_in_image_viewer': {
        await passOptionToTab(tab.id, currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-canvas.js']})
        break
      }
    }
  })
}

function addCommandHandler() {
  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (!tab.url) return
    switch (command) {
      case 'open-image-viewer': {
        await passOptionToTab(tab.id, currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
        break
      }
      case 'open-image-viewer-without-size-filter': {
        await passOptionToTab(tab.id, currOptionsWithoutSize)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-page.js']})
        break
      }
      case 'open-image-viewer-in-canvases-mode': {
        await passOptionToTab(tab.id, currOptions)
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/action-canvas.js']})
        break
      }
    }
  })
}

function init() {
  resetLocalStorage()
  addMessageHandler()
  addToolbarIconHandler()
  createContextMenu()
  addCommandHandler()
  console.log('Init complete')
}

init()
