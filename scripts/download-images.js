;(function () {
  'use strict'

  const safeSendMessage = function (...args) {
    if (chrome.runtime?.id) {
      return chrome.runtime.sendMessage(...args)
    }
  }

  // zip
  function generateCRCTable() {
    const crcTable = new Uint32Array(256)
    const polynomial = 0xedb88320 // CRC-32 polynomial

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
  }
  function calculateCRC32(data) {
    const crcTable = generateCRCTable()
    let crc = 0xffffffff // Initial CRC value

    for (let i = 0; i < data.length; i++) {
      const byte = data[i]
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
    }

    crc ^= 0xffffffff // Final XOR value
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

    // Construct the local file header
    const localFileHeader = new Uint8Array(30 + filenameLength + compressedSize)
    const view = new DataView(localFileHeader.buffer)

    // Little-endian byte order
    view.setUint32(0, 0x04034b50, true) // Local file header signature
    view.setUint16(4, 20, true) // Version needed to extract (minimum)
    view.setUint16(6, 0, true) // No special flags
    view.setUint16(8, 0, true) // No compression
    view.setUint16(10, 0, true) // Placeholder for modification time (not used)
    view.setUint16(12, 0, true) // Placeholder for modification date (not used)
    view.setUint32(14, crc32, true) // CRC-32 of uncompressed data
    view.setUint32(18, compressedSize, true) // Compressed size
    view.setUint32(22, compressedSize, true) // Uncompressed size
    view.setUint16(26, filenameLength, true) // File name length
    view.setUint16(28, 0, true) // No extra fields
    localFileHeader.set(filenameBytes, 30) // File name
    localFileHeader.set(data, 30 + filenameLength) // File data

    return localFileHeader
  }
  function buildCentralDirectory(localFileHeader, offset) {
    const headerView = new DataView(localFileHeader.buffer)
    const filenameLength = headerView.getUint16(26, true)
    const headerData = localFileHeader.subarray(4, 30)
    const fileName = localFileHeader.subarray(30, 30 + filenameLength)

    // Construct the central directory entry
    const centralDirectoryEntry = new Uint8Array(46 + filenameLength)
    const view = new DataView(centralDirectoryEntry.buffer)

    // Little-endian byte order
    view.setUint32(0, 0x02014b50, true) // Central directory file header signature
    view.setUint16(4, 20, true) // Version made by
    centralDirectoryEntry.set(headerData, 6) // CDE 6-32 = LFH 4-30
    view.setUint16(32, 0, true) // No file comment
    view.setUint16(34, 0, true) // Disk number start
    view.setUint16(36, 0, true) // Internal file attributes
    view.setUint32(38, 0, true) // External file attributes
    view.setUint32(42, offset, true) // Relative offset of local file header
    centralDirectoryEntry.set(fileName, 46) // File name

    return centralDirectoryEntry
  }

  function buildZip(localFileHeaderList) {
    const centralDirectoryList = []
    let centralOffset = 0

    // Build central directory entries
    for (let i = 0; i < localFileHeaderList.length; i++) {
      const localFileHeader = localFileHeaderList[i]
      const centralDirectoryEntry = buildCentralDirectory(localFileHeader, centralOffset)
      centralDirectoryList.push(centralDirectoryEntry)
      centralOffset += localFileHeader.length
    }

    // Calculate the size of the central directory
    const centralDirectorySize = centralDirectoryList.reduce((total, entry) => total + entry.length, 0)

    // Build the end of central directory record
    const endOfCentralDirectoryRecord = new Uint8Array(22)
    const view = new DataView(endOfCentralDirectoryRecord.buffer)

    view.setUint32(0, 0x06054b50, true) // End of central directory signature
    view.setUint16(4, 0, true) // Number of this disk
    view.setUint16(6, 0, true) // Disk where central directory starts
    view.setUint16(8, localFileHeaderList.length, true) // Number of central directory records on this disk
    view.setUint16(10, localFileHeaderList.length, true) // Total number of central directory records
    view.setUint32(12, centralDirectorySize, true) // Size of central directory
    view.setUint32(16, centralOffset, true) // Offset of start of central directory
    view.setUint16(20, 0, true) // No comment

    // Combine all the components into the final zip file
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
          .map(n => Math.min(length, Math.max(1, Number(n))) - 1)
          .sort((a, b) => a - b)
        for (let i = start; i <= end; i++) {
          result[i] = true
        }
      } else {
        const index = Math.min(length, Math.max(1, Number(part))) - 1
        result[index] = true
      }
    }

    return result
  }
  function getImageBinary(url) {
    return fetch(url)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => new Uint8Array(arrayBuffer))
      .catch(async () => {
        const [dataUrl] = await safeSendMessage({msg: 'request_cors_url', url: url})
        const res = await fetch(dataUrl)
        const rawArray = await res.arrayBuffer()
        return new Uint8Array(rawArray)
      })
  }

  // main
  async function main() {
    const imageList = ImageViewer('get_image_list')
    if (imageList.length === 0) return

    const imageUrlList = imageList.map(img => img.src)
    const selectionRange = getUserSelection(imageUrlList.length)
    if (selectionRange === null) return

    const selectedUrlList = imageUrlList.map((v, i) => [v, i]).filter(item => selectionRange[item[1]])
    if (selectedUrlList.length === 0) return

    const imageBinaryList = await Promise.all(selectedUrlList.map(async item => [await getImageBinary(item[0]), item[1]]))

    const localFileHeaderList = []
    for (const [data, index] of imageBinaryList) {
      const indexString = ('0000' + (index + 1)).slice(-5)
      const url = imageUrlList[index]
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
