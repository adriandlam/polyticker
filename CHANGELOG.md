# Changelog

## [1.0.0](https://github.com/adriandlam/polyticker/compare/v0.1.0...v1.0.0) (2026-02-26)


### ⚠ BREAKING CHANGES

* update all docs and cut release ([#12](https://github.com/adriandlam/polyticker/issues/12))

### Features

* add backfill script for creating archives of existing intervals ([a3a25f3](https://github.com/adriandlam/polyticker/commit/a3a25f32a4bdaeecfcd5f58bd4a79d7d238d922f))
* add cloudflare worker for R2 directory browsing ([#5](https://github.com/adriandlam/polyticker/issues/5)) ([e64e063](https://github.com/adriandlam/polyticker/commit/e64e0639d8078c0cbd522fccc12535dfd51efd25))
* **collector:** build and upload .tar.gz archive per interval ([e32d906](https://github.com/adriandlam/polyticker/commit/e32d906d2b517f0a97e7b0b1900f192a197ca2fe))
* daily data archives and backtest documentation ([#8](https://github.com/adriandlam/polyticker/issues/8)) ([61a7f40](https://github.com/adriandlam/polyticker/commit/61a7f407e92c2ec41dacb54086114b3b7068c3ca))
* replace git lfs with cloudflare r2 storage ([#2](https://github.com/adriandlam/polyticker/issues/2)) ([536d80a](https://github.com/adriandlam/polyticker/commit/536d80ac48349d1f3f98c8ae45b1c0bc3c60ab50))
* update all docs and cut release ([#12](https://github.com/adriandlam/polyticker/issues/12)) ([6f756a3](https://github.com/adriandlam/polyticker/commit/6f756a30cdde3634b239b7c05803bddf8cdde498))
* **worker:** add observability ([9843a95](https://github.com/adriandlam/polyticker/commit/9843a95e991a11abfc11354b6b189b6ab36c9659))
* **worker:** replace bulk tar builder with archive-serving endpoint ([ab66e69](https://github.com/adriandlam/polyticker/commit/ab66e69b5c525c61e346389a482463e2ac13a0ed))
* **worker:** REST JSON API for backtesting ([#6](https://github.com/adriandlam/polyticker/issues/6)) ([a542e6e](https://github.com/adriandlam/polyticker/commit/a542e6e8871260f43e12227f6d9923e12fdb84ab))
* **worker:** tar.gz content negotiation for bulk downloads ([#9](https://github.com/adriandlam/polyticker/issues/9)) ([65fb08e](https://github.com/adriandlam/polyticker/commit/65fb08e9696bef1b929cc545f107a9d108f8d9fb))


### Bug Fixes

* add region_name=auto for R2 boto3 client ([f352c9c](https://github.com/adriandlam/polyticker/commit/f352c9c8cd54821b6d7982c9ad7063ad94491bc8))
* allow standaolone from query param ([f0607b1](https://github.com/adriandlam/polyticker/commit/f0607b13cd942571a9f535c7eb0fda86e1f936b9))
* **websocket:** stale connections and unhandled exceptions ([#13](https://github.com/adriandlam/polyticker/issues/13)) ([a1d4bd8](https://github.com/adriandlam/polyticker/commit/a1d4bd8470c4c68907d197ba0008728bde286803))
* **worker:** redirect directory paths without trailing slash ([#7](https://github.com/adriandlam/polyticker/issues/7)) ([8f8644e](https://github.com/adriandlam/polyticker/commit/8f8644ebfffa5d1dfc5ef736ac8e0f2d971590fe))
* **worker:** stream tar.gz to avoid OOM on bulk downloads ([#10](https://github.com/adriandlam/polyticker/issues/10)) ([3250b92](https://github.com/adriandlam/polyticker/commit/3250b9264d80c6b31cc1fe2a9048800206afafc4))


### Documentation

* add CLAUDE.md ([f8a26f8](https://github.com/adriandlam/polyticker/commit/f8a26f89ed2edbf8383c530210fa0e927a59542d))
* add pre-built archives implementation plan ([c44b91c](https://github.com/adriandlam/polyticker/commit/c44b91c6eda6aef94a04375608a2b7a16df7846a))
* add pre-built per-interval archives design ([77be9e6](https://github.com/adriandlam/polyticker/commit/77be9e66b445bdd9ce1c3f6a64e482eef043ea87))
* update backtest example to use per-interval archive API ([bbfab32](https://github.com/adriandlam/polyticker/commit/bbfab3276048e1532081fd58a814ea02e36eef54))

## 0.1.0 (2026-02-25)


### Features

* polymarket btc up down 5m data collector ([0d88c11](https://github.com/adriandlam/polyticker/commit/0d88c1129d83de44a2e4487fa1b9a380c4007432))
