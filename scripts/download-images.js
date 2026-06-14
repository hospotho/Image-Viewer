;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  // parallel fetch
  const semaphore = (() => {
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
          return Promise.resolve(release)
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

  const corsHostSet = window.corsHostSet

  // zip
  const crcTable = (() => {
    const crcTable = new Uint32Array(256)
    const polynomial = 0xedb88320 // lsb-first

    for (let i = 0; i < 256; i++) {
      let crc = i
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crc = crc & 1 ? (crc >>> 1) ^ polynomial : crc >>> 1
      crcTable[i] = crc
    }
    return crcTable
  })()
  function calculateCRC32(data) {
    let crc = 0xffffffff // initial value
    for (const byte of data) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
    }
    return (crc ^ 0xffffffff) >>> 0 // final xor value
  }

  const LOCAL_FILE_HEADER_SIZE = 30
  const CENTRAL_DIRECTORY_HEADER_SIZE = 46
  const END_OF_CENTRAL_DIRECTORY_SIZE = 22
  function buildEndOfCentralDirectoryRecord(imageCount, centralDirectorySize, centralOffset) {
    // construct the end of central directory record
    const endOfCentralDirectoryRecord = new Uint8Array(END_OF_CENTRAL_DIRECTORY_SIZE)
    const view = new DataView(endOfCentralDirectoryRecord.buffer)

    // little-endian byte order
    view.setUint32(0, 0x06054b50, true) // end of central directory signature
    view.setUint16(4, 0, true) // number of this disk
    view.setUint16(6, 0, true) // disk where central directory starts
    view.setUint16(8, imageCount, true) // number of central directory records on this disk
    view.setUint16(10, imageCount, true) // total number of central directory records
    view.setUint32(12, centralDirectorySize, true) // size of central directory
    view.setUint32(16, centralOffset, true) // offset of start of central directory
    view.setUint16(20, 0, true) // no comment

    return endOfCentralDirectoryRecord
  }
  function buildCentralDirectory(localFileHeader, offset) {
    const headerView = new DataView(localFileHeader.buffer)
    const filenameLength = headerView.getUint16(26, true)
    const headerData = localFileHeader.subarray(4, LOCAL_FILE_HEADER_SIZE)
    const fileName = localFileHeader.subarray(LOCAL_FILE_HEADER_SIZE, LOCAL_FILE_HEADER_SIZE + filenameLength)

    // construct the central directory entry
    const centralDirectoryEntry = new Uint8Array(CENTRAL_DIRECTORY_HEADER_SIZE + filenameLength)
    const view = new DataView(centralDirectoryEntry.buffer)

    // little-endian byte order
    view.setUint32(0, 0x02014b50, true) // central directory file header signature
    view.setUint16(4, 20, true) // version made by
    centralDirectoryEntry.set(headerData, 6) // offset 6-32 = lfh 4-30
    view.setUint16(32, 0, true) // no file comment
    view.setUint16(34, 0, true) // disk number start
    view.setUint16(36, 0, true) // internal file attributes
    view.setUint32(38, 0, true) // external file attributes
    view.setUint32(42, offset, true) // relative offset of local file header
    centralDirectoryEntry.set(fileName, CENTRAL_DIRECTORY_HEADER_SIZE) // file name

    return centralDirectoryEntry
  }
  function buildLocalFileHeader(filenameBytes, data) {
    const filenameLength = filenameBytes.length
    const compressedSize = data.length
    const crc32 = calculateCRC32(data)

    // construct the local file header
    const localFileHeader = new Uint8Array(LOCAL_FILE_HEADER_SIZE + filenameLength + compressedSize)
    const view = new DataView(localFileHeader.buffer)

    // little-endian byte order
    view.setUint32(0, 0x04034b50, true) // local file header signature
    view.setUint16(4, 20, true) // version needed to extract (minimum)
    view.setUint16(6, 0, true) // no special flags
    view.setUint16(8, 0, true) // no compression
    view.setUint16(10, 0, true) // placeholder for modification time (not used)
    view.setUint16(12, 0, true) // placeholder for modification date (not used)
    view.setUint32(14, crc32, true) // crc-32 of uncompressed data
    view.setUint32(18, compressedSize, true) // compressed size
    view.setUint32(22, compressedSize, true) // uncompressed size
    view.setUint16(26, filenameLength, true) // file name length
    view.setUint16(28, 0, true) // no extra fields
    localFileHeader.set(filenameBytes, LOCAL_FILE_HEADER_SIZE) // file name
    localFileHeader.set(data, LOCAL_FILE_HEADER_SIZE + filenameLength) // file data

    return localFileHeader
  }
  function buildZip(filenameList, imageBinaryList) {
    const encoder = new TextEncoder()
    const encodedFilenameList = filenameList.map(filename => encoder.encode(filename))

    // calculate total size
    let totalHeaderSize = 0
    let totalDirectorySize = 0
    for (let i = 0; i < imageBinaryList.length; i++) {
      const filenameLength = encodedFilenameList[i].length
      const dataLength = imageBinaryList[i].length
      totalHeaderSize += LOCAL_FILE_HEADER_SIZE + filenameLength + dataLength
      totalDirectorySize += CENTRAL_DIRECTORY_HEADER_SIZE + filenameLength
    }

    // construct the zip file
    const zipSize = totalHeaderSize + totalDirectorySize + END_OF_CENTRAL_DIRECTORY_SIZE
    const zipFile = new Uint8Array(zipSize)

    // build zip file
    let offset = 0
    let centralOffset = totalHeaderSize
    for (let i = 0; i < imageBinaryList.length; i++) {
      const localFileHeader = buildLocalFileHeader(encodedFilenameList[i], imageBinaryList[i])
      const centralDirectoryEntry = buildCentralDirectory(localFileHeader, offset)
      zipFile.set(localFileHeader, offset)
      zipFile.set(centralDirectoryEntry, centralOffset)
      offset += localFileHeader.length
      centralOffset += centralDirectoryEntry.length
    }
    const endOfCentralDirectoryRecord = buildEndOfCentralDirectoryRecord(imageBinaryList.length, totalDirectorySize, totalHeaderSize)
    zipFile.set(endOfCentralDirectoryRecord, centralOffset)

    return zipFile
  }

  // utility
  function getUserSelection(length) {
    if (length === 1) return [true]

    const userSelection = prompt("Images to Download: eg. '1-5, 8, 11-13'", `1-${length}`)
    if (!userSelection) return null

    const input = userSelection.replaceAll(' ', '')
    const regex = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/
    if (!regex.test(input)) {
      alert('Invalid selection.')
      return null
    }

    const result = new Array(length).fill(false)
    const processedInput = input.split(',')
    for (const part of processedInput) {
      if (part.includes('-')) {
        const [start, end] = part
          .split('-')
          .map(n => Math.min(Math.max(Number(n), 1), length) - 1)
          .sort((a, b) => a - b)
        for (let i = start; i <= end; i++) {
          result[i] = true
        }
      } else {
        const index = Math.min(Math.max(Number(part), 1), length) - 1
        result[index] = true
      }
    }

    return result
  }
  async function getCorsImageBinary(url) {
    const [dataUrl] = await safeSendMessage({msg: 'request_cors_url', url: url})
    return fetch(dataUrl)
      .then(res => res.arrayBuffer())
      .then(buffer => new Uint8Array(buffer))
  }
  async function getImageBinary(url) {
    const release = await semaphore.acquire()
    const host = new URL(url).hostname
    if (corsHostSet.has(host)) {
      const [dataUrl] = await safeSendMessage({msg: 'request_cors_url', url: url})
      url = dataUrl
    }
    return fetch(url)
      .then(res => res.arrayBuffer())
      .then(buffer => new Uint8Array(buffer))
      .catch(() => corsHostSet.add(host) && getCorsImageBinary(url))
      .finally(() => release())
  }
  async function downloadImages(selectedUrlList) {
    let progress = 0
    const filenameList = []
    const asyncList = []
    for (const [url, index] of selectedUrlList) {
      const indexString = ('0000' + (index + 1)).slice(-5)
      const name = url.startsWith('data') ? '' : '_' + url.split('?')[0].split('/').at(-1)
      const extension = name.includes('.') ? '' : '.jpg'
      const filename = indexString + name + extension
      filenameList.push(filename)

      const promise = getImageBinary(url)
      promise.finally(() => (progress += 1))
      asyncList.push(promise)
    }

    const length = selectedUrlList.length
    const interval = setInterval(() => {
      console.log(`Downloading: ${progress} / ${length}`)
      if (progress === length) {
        clearInterval(interval)
        console.log('Download complete.')
      }
    }, 3000)

    const imageBinaryList = await Promise.all(asyncList)
    return [filenameList, imageBinaryList]
  }

  // main
  async function main() {
    const imageList = ImageViewer('get_image_list')
    if (imageList.length === 0) return

    const selectionRange = getUserSelection(imageList.length)
    if (selectionRange === null) return

    const selectedUrlList = imageList.map((img, i) => selectionRange[i] && [img.src, i]).filter(Boolean)
    if (selectedUrlList.length === 0) return

    const [filenameList, imageBinaryList] = await downloadImages(selectedUrlList)
    const zip = buildZip(filenameList, imageBinaryList)
    const blob = new Blob([zip.buffer])

    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob, 'application/zip')
    a.download = `ImageViewer_${Date.now()}_${document.title}.zip`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  main()
})()
