const i18n = tag => chrome.i18n.getMessage(tag)
const getOptions = () => {
  return new Promise(resolve => {
    chrome.storage.sync.get('options', res => resolve(res))
  })
}
const passDataToTab = (id, data, name) => {
  console.log('passDataToTab: ', id, data, name)
  return chrome.scripting.executeScript({
    args: [data, name],
    target: {tabId: id},
    func: (data, name) => {
      window[name] = data
    }
  })
}

function resetLocalStorage() {
  chrome.storage.sync.get('options', res => {
    if (res && Object.keys(res).length === 0 && Object.getPrototypeOf(res) === Object.prototype) {
      const defaultOptions = {
        fitMode: 'both',
        zoomRatio: 1.2,
        rotateDeg: 15,
        minWidth: 150,
        minHeight: 150,
        debouncePeriod: 1500,
        throttlePeriod: 80,
        hotkey: ['Shift + Q', 'Shift + W', 'Shift + E', 'Shift + R', 'Ctrl + Alt + Q', ''],
        customUrl: ['https://example.com/search?query={imgSrc}&option=example_option']
      }
      chrome.storage.sync.set({options: defaultOptions}, () => {
        console.log('Set options to default values.')
      })
      chrome.runtime.openOptionsPage()
      return
    }
    console.log('Init complete.')
    console.log(res)
  })
}

function addMessageHandler() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message: ', sender.tab.id, request)
    switch (request.msg || request) {
      case 'get_options': {
        chrome.storage.sync.get('options', res => sendResponse(res))
        return true
      }
      case 'load_utility': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['/scripts/utility.js']}, () => sendResponse({}))
        return true
      }
      case 'load_script': {
        chrome.scripting.executeScript({target: {tabId: sender.tab.id}, files: ['image-viewer.js']}, () => sendResponse({}))
        return true
      }
      case 'load_frames': {
        const script = '/scripts/activate-iframe' + (request.filter === true ? '.js' : '-all.js')
        chrome.scripting.executeScript({target: {tabId: sender.tab.id, allFrames: true}, files: [script]}, results => {
          let args = []
          for (const result of results) {
            if (!result.result) continue
            args.push(...result.result)
          }
          sendResponse(args)
        })
        return true
      }
      case 'open_tab': {
        chrome.tabs.create({active: false, index: sender.tab.index + 1, url: request.url}, () => sendResponse({}))
        return true
      }
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

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    console.log(info.menuItemId)
    const {options} = await getOptions()
    await passDataToTab(tab.id, options, 'ImageViewerOption')
    switch (info.menuItemId) {
      case 'open_in_image_viewer': {
        await passDataToTab(tab.id, info.srcUrl, 'ImageViewerTargetUrl')
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-image.js']})
        return
      }
      case 'open_image_viewer': {
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
        return
      }
      case 'open_all_image_in_image_viewer': {
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-all.js']})
        return
      }
    }
  })
}

function addTooltipdHandler() {
  chrome.action.onClicked.addListener(async tab => {
    const {options} = await getOptions()
    await passDataToTab(tab.id, options, 'ImageViewerOption')
    chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
  })
}

function addCommandHandler() {
  chrome.commands.onCommand.addListener(async (command, tab) => {
    const {options} = await getOptions()
    await passDataToTab(tab.id, options, 'ImageViewerOption')
    switch (command) {
      case 'open-image-viewer': {
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-page.js']})
        return
      }
      case 'open-image-viewer-without-size-filter': {
        chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['/scripts/activate-all.js']})
        return
      }
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
