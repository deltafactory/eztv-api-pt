// Import the necessary modules.
const cheerio = require('cheerio')
const debug = require('debug')
const got = require('got')
const { stringify } = require('querystring')

const { name } = require('./package.json')

/**
 * Show object which will be returned.
 * @typedef {Object} Show
 * @property {string} show The name of the show.
 * @property {number} id The eztv id of the show.
 * @property {string} slug The slug of the show.
 * @property {string} imdb The imdb code of the show.
 * @property {Object} episodes The episodes of the show.
 */

/**
 * The response object of the API call.
 * @typedef {Object} ApiResponse
 * @property {string} imdb_id The imdb id of the response.
 * @property {number} torrent_count The total number of torrents.
 * @property {number} limit The limit of the torrents response.
 * @property {number} page The page of the torrents response.
 * @property {Array<Torrent>} torrent The torrent of the response.
 */

/**
 * The model of the torrent object.
 * @typedef {Object} Torrent
 * @property {number} id The id of the torrent
 * @property {string} hash The hash of the torrent.
 * @property {string} filename The filename of the torrent.
 * @property {string} episode_url The episode url of the torrent.
 * @property {string} torrent_url The torrent url of the torrent.
 * @property {string} magnet_url The magnet url of the torrent.
 * @property {string} title The title of the torrent.
 * @property {string} imdb_id The imdb id of the torrent.
 * @property {number} season The season of the torrent.
 * @property {number} episode The episode of the torrent.
 * @property {string} small_screenshot The small screenshot of the torrent.
 * @property {string} large_screenshot The large screenshot of the torrent.
 * @property {number} seeds The seeds of the torrent.
 * @property {number} peers The peers of the torrent.
 * @property {number} date_released_unix The epoch time the torrent was
 * released.
 * @property {string} size_bytes The size of the torrent in bytes.
 */

/**
 * An EZTV API wrapper to get data from eztv.ag.
 * @type {EztvApi}
 */
module.exports = class EztvApi {

  /**
   * Create a new instance of the module.
   * @param {!Object} config={} - The configuration object for the module.
   * @param {!string} baseUrl=https://eztv.ag/ - The base url of eztv.
   */
  constructor({ baseUrl = 'https://eztv.ag/' } = {}) {
    /**
     * The base url of eztv.
     * @type {string}
     */
    this._baseUrl = baseUrl
    /**
     * Show extra output.
     * @type {Function}
     */
    this._debug = debug(name)
  }

  /**
   * Make a get request to eztv.ag.
   * @param {!string} endpoint - The endpoint to make the request to.
   * @param {?Object} query - The query parameters of the HTTP request.
   * @param {?boolean} raw - Get the raw body of the response.
   * @returns {Promise<Function, Error>} - The response body wrapped in
   * cheerio.
   */
  _get(endpoint, query = {}, raw = false) {
    const uri = `${this._baseUrl}${endpoint}`
    const opts = {
      query
    }

    this._debug(`Making request to: '${uri}?${stringify(query)}'`)

    if (raw) {
      opts.json = true
    }

    return got.get(uri, opts).then(({ body }) => {
      if (raw) {
        return body
      }

      return cheerio.load(body)
    })
  }

  /**
   * Get additional data from a show, like imdb codes and episodes.
   * @param {Show} data - The show you want additional data from.
   * @param {Function} $ - The cheerio function.
   * @returns {Show} - The show with additional data.
   */
  _getEpisodeData(data, $) {
    let imdb = $('div[itemtype="http://schema.org/AggregateRating"]')
      .find('a[target="_blank"]')
      .attr('href')
    imdb = imdb ? imdb.match(/\/title\/(.*)\//)[1] : undefined

    if (imdb) {
      data.imdb = imdb
    }

    const table = 'tr.forum_header_border[name="hover"]'
    $(table).each(function () {
      const entry = $(this)
      const magnet = entry.children('td').eq(2)
        .children('a.magnet')
        .first()
        .attr('href')

      if (!magnet) {
        return
      }

      const seasonBased = /S?0*(\d+)[xE]0*(\d+)/i
      const dateBased = /(\d{4}).(\d{2}.\d{2})/i
      const title = entry.children('td').eq(1)
        .text()
        .replace('x264', '')
      let season
      let episode

      if (title.match(seasonBased)) {
        season = parseInt(title.match(seasonBased)[1], 10)
        episode = parseInt(title.match(seasonBased)[2], 10)
        data.dateBased = false
      } else if (title.match(dateBased)) {
        season = title.match(dateBased)[1]
        episode = title.match(dateBased)[2].replace(/\s/g, '-')
        data.dateBased = true
      } else {
        season = 0
        episode = 0
      }

      if (season && episode) {
        if (!data.episodes) {
          data.episodes = {}
        }

        if (!data.episodes[season]) {
          data.episodes[season] = {}
        }

        if (!data.episodes[season][episode]) {
          data.episodes[season][episode] = {}
        }

        const quality = title.match(/(\d{3,4})p/)
          ? title.match(/(\d{3,4})p/)[0]
          : '480p'

        const torrent = {
          url: magnet,
          seeds: 0,
          peers: 0,
          provider: 'EZTV'
        }

        if (
          !data.episodes[season][episode][quality] ||
          title.toLowerCase().indexOf('repack') > -1
        ) {
          data.episodes[season][episode][quality] = torrent
        }
      }
    })

    return data
  }

  /**
   * Get all the available shows from eztv.
   * @return {Promise<Array<Show>, Error>} - All the available shows from eztv.
   */
  getAllShows() {
    return this._get('showlist/').then($ => {
      const regex = /\/shows\/(.*)\/(.*)\//

      return $('.thread_link').map(function () {
        const entry = $(this)
        const href = entry.attr('href')

        const show = entry.text()
        const id = parseInt(href.match(regex)[1], 10)
        const slug = href.match(regex)[2]

        return {
          show,
          id,
          slug
        }
      }).get()
    })
  }

  /**
   * Get episodes for a show.
   * @param {Show} data - Teh show to get episodes for.
   * @returns {Promise<Show, Error>} - The show with additional data.
   */
  getShowData(data) {
    return this._get(`shows/${data.id}/${data.slug}/`)
      .then($ => this._getEpisodeData(data, $))
  }

  /**
   * Search for episodes of a show.
   * @param {Show} data - The show to get episodes for.
   * @returns {Promise<Show, Error>} - The show with additional data.
   */
  getShowEpisodes(data) {
    return this._get('search/')
      .then($ => this._getEpisodeData(data, $))
  }

  /**
   * Get a list of torrents.
   * @param {!Object} config={} - The config object of the method.
   * @param {!number} config.page=1 - The page of the API call.
   * @param {!number} config.limit=10 - The limit of the API call.
   * @returns {Promise<ApiResponse, Error>} - The response object of an API
   * call.
   */
  getTorrents({ page = 1, limit = 30, imdb } = {}) {
    let imdbId
    if (typeof imdb === 'string' && imdb.startsWith('tt')) {
      imdbId = imdb.substring(2, imdb.length)
    } else {
      imdbId = imdb
    }

    return this._get('api/get-torrents', {
      page,
      limit,
      imdb_id: imdbId
    }, true)
  }

}
