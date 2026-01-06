;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

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
    for (let i = 0; i < data.length; i++) {
      const byte = data[i]
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
    }
    crc ^= 0xffffffff // final xor value

    const crcBytes = new Uint8Array(4)
    crcBytes[0] = (crc >> 24) & 0xff
    crcBytes[1] = (crc >> 16) & 0xff
    crcBytes[2] = (crc >> 8) & 0xff
    crcBytes[3] = crc & 0xff
    return crcBytes
  }

  function buildLocalFileHeader(filename, data) {
    const crc32 = calculateCRC32(data)
    const compressedSize = data.length
    const encoder = new TextEncoder()
    const filenameBytes = encoder.encode(filename)
    const filenameLength = filenameBytes.length

    // construct the local file header
    const localFileHeader = new Uint8Array(30 + filenameLength + compressedSize)
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
    localFileHeader.set(filenameBytes, 30) // file name
    localFileHeader.set(data, 30 + filenameLength) // file data

    return localFileHeader
  }
  function buildCentralDirectory(localFileHeader, offset) {
    const headerView = new DataView(localFileHeader.buffer)
    const filenameLength = headerView.getUint16(26, true)
    const headerData = localFileHeader.subarray(4, 30)
    const fileName = localFileHeader.subarray(30, 30 + filenameLength)

    // construct the central directory entry
    const centralDirectoryEntry = new Uint8Array(46 + filenameLength)
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
    centralDirectoryEntry.set(fileName, 46) // file name

    return centralDirectoryEntry
  }
  function buildZip(localFileHeaderList) {
    const centralDirectoryList = []
    let centralOffset = 0

    // build central directory entries
    for (let i = 0; i < localFileHeaderList.length; i++) {
      const localFileHeader = localFileHeaderList[i]
      const centralDirectoryEntry = buildCentralDirectory(localFileHeader, centralOffset)
      centralDirectoryList.push(centralDirectoryEntry)
      centralOffset += localFileHeader.length
    }

    // calculate the size of the central directory
    const centralDirectorySize = centralDirectoryList.reduce((total, entry) => total + entry.length, 0)

    // build the end of central directory record
    const endOfCentralDirectoryRecord = new Uint8Array(22)
    const view = new DataView(endOfCentralDirectoryRecord.buffer)

    view.setUint32(0, 0x06054b50, true) // end of central directory signature
    view.setUint16(4, 0, true) // number of this disk
    view.setUint16(6, 0, true) // disk where central directory starts
    view.setUint16(8, localFileHeaderList.length, true) // number of central directory records on this disk
    view.setUint16(10, localFileHeaderList.length, true) // total number of central directory records
    view.setUint32(12, centralDirectorySize, true) // size of central directory
    view.setUint32(16, centralOffset, true) // offset of start of central directory
    view.setUint16(20, 0, true) // no comment

    // combine all the components into the final zip file
    const zipSize = centralOffset + centralDirectorySize + endOfCentralDirectoryRecord.length
    const zipFile = new Uint8Array(zipSize)

    let offset = 0
    for (const localFileHeader of localFileHeaderList) {
      zipFile.set(localFileHeader, offset)
      offset += localFileHeader.length
    }
    for (const centralDirectoryEntry of centralDirectoryList) {
      zipFile.set(centralDirectoryEntry, offset)
      offset += centralDirectoryEntry.length
    }
    zipFile.set(endOfCentralDirectoryRecord, offset)

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
    return fetch(url)
      .then(res => res.arrayBuffer())
      .then(buffer => new Uint8Array(buffer))
      .catch(() => getCorsImageBinary(url))
      .finally(() => release())
  }
  function getImageBinaryList(selectedUrlList) {
    const length = selectedUrlList.length
    const progress = new Array(length).fill(0)

    const asyncList = []
    for (let i = 0; i < length; i++) {
      const [url, index] = selectedUrlList[i]
      const promise = getImageBinary(url).then(data => [url, index, data])
      promise.finally(() => (progress[i] = 1))
      asyncList.push(promise)
    }

    const interval = setInterval(() => {
      const total = progress.reduce((a, c) => a + c, 0)
      console.log(`Downloading: ${total} / ${length}`)
      if (total === length) {
        clearInterval(interval)
        console.log('Download complete.')
      }
    }, 3000)

    return Promise.all(asyncList)
  }

  // main
  async function main() {
    const imageList = ImageViewer('get_image_list')
    if (imageList.length === 0) return

    const selectionRange = getUserSelection(imageList.length)
    if (selectionRange === null) return

    const selectedUrlList = imageList.map((img, i) => selectionRange[i] && [img.src, i]).filter(Boolean)
    if (selectedUrlList.length === 0) return

    const imageBinaryList = await getImageBinaryList(selectedUrlList)

    const localFileHeaderList = []
    for (const [url, index, data] of imageBinaryList) {
      const indexString = ('0000' + (index + 1)).slice(-5)
      const name = url.startsWith('data') ? '' : '_' + url.split('?')[0].split('/').at(-1)
      const extension = name.includes('.') ? '' : '.jpg'
      const filename = indexString + name + extension

      const localFileHeader = buildLocalFileHeader(filename, data)
      localFileHeaderList.push(localFileHeader)
    }
    const zip = buildZip(localFileHeaderList)
    const blob = new Blob([zip.buffer])

    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob, 'application/zip')
    a.download = `ImageViewer_${Date.now()}_${document.title}.zip`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  main()
})()
