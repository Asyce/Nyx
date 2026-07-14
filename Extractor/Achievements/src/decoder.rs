use crate::capture::SnapshotDecoder;
use crate::{AchievementRecord, Game};
use auto_artifactarium::{
    GamePacket as GiPacket, GameSniffer as GiSniffer, matches_achievement_packet as gi_achievements,
};
use auto_reliquary::{
    GamePacket as HsrPacket, GameSniffer as HsrSniffer,
    matches_achievement_packet as hsr_achievements,
};
use base64::{Engine, prelude::BASE64_STANDARD};
use std::collections::HashMap;

pub const STARDB_SOURCE_COMMIT: &str = "8952306535f3fdcae1a7bc29ad3ea67b7fa6d7ef";
pub const GI_SOURCE_SHA256: &str =
    "b183ec29f1e2f7327a6ffdde60df8b1044f2c888333f51877ecd56c67007a5b1";
pub const HSR_SOURCE_SHA256: &str =
    "a4b92a819d8a0798a297be61f1478179df75875152b90e0f98b6ef3dff75e5e9";
pub const GI_CANONICAL_SHA256: &str =
    "37ccd359c35b0f990032e7941ed140914a322b935706a1c66d252b27dd74f3c3";
pub const HSR_CANONICAL_SHA256: &str =
    "8cf5663effcef7540a4bb14678442f99c86bb746000ef5170505905ad084a698";

pub enum GameDecoder {
    Gi(GiSniffer),
    Hsr(HsrSniffer),
}

impl GameDecoder {
    pub fn new(game: Game) -> Result<Self, String> {
        match game {
            Game::Gi => {
                let encoded: HashMap<u16, String> =
                    serde_json::from_slice(include_bytes!("../keys/gi.json"))
                        .map_err(|_| "invalid embedded GI keys")?;
                let keys = encoded
                    .into_iter()
                    .map(|(id, value)| {
                        BASE64_STANDARD
                            .decode(value)
                            .map(|bytes| (id, bytes))
                            .map_err(|_| "invalid embedded GI key")
                    })
                    .collect::<Result<HashMap<_, _>, _>>()?;
                Ok(Self::Gi(GiSniffer::new().set_initial_keys(keys)))
            }
            Game::Hsr => {
                let encoded: HashMap<u32, String> =
                    serde_json::from_slice(include_bytes!("../keys/hsr.json"))
                        .map_err(|_| "invalid embedded HSR keys")?;
                let keys = encoded
                    .into_iter()
                    .map(|(id, value)| {
                        BASE64_STANDARD
                            .decode(value)
                            .map(|bytes| (id, bytes))
                            .map_err(|_| "invalid embedded HSR key")
                    })
                    .collect::<Result<HashMap<_, _>, _>>()?;
                Ok(Self::Hsr(HsrSniffer::new().set_initial_keys(keys)))
            }
        }
    }
}

impl SnapshotDecoder for GameDecoder {
    fn decode(&mut self, frame: &[u8]) -> Option<Vec<AchievementRecord>> {
        match self {
            Self::Gi(sniffer) => {
                let GiPacket::Commands(commands) = sniffer.receive_packet(frame.to_vec())? else {
                    return None;
                };
                commands.into_iter().find_map(|command| {
                    gi_achievements(&command).map(|rows| {
                        rows.into_iter()
                            .map(|row| AchievementRecord {
                                id: row.id,
                                status: row.status,
                            })
                            .collect()
                    })
                })
            }
            Self::Hsr(sniffer) => {
                let HsrPacket::Commands(commands) = sniffer.receive_packet(frame.to_vec())? else {
                    return None;
                };
                commands.into_iter().find_map(|command| {
                    hsr_achievements(&command).map(|rows| {
                        rows.into_iter()
                            .map(|row| AchievementRecord {
                                id: row.id,
                                status: row.status,
                            })
                            .collect()
                    })
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    #[test]
    fn authorized_key_maps_have_exact_hashes_and_counts() {
        let gi = include_bytes!("../keys/gi.json");
        let hsr = include_bytes!("../keys/hsr.json");
        let gi_map = serde_json::from_slice::<std::collections::BTreeMap<u32, String>>(gi).unwrap();
        let hsr_map =
            serde_json::from_slice::<std::collections::BTreeMap<u32, String>>(hsr).unwrap();
        assert_eq!(gi_map.len(), 10);
        assert_eq!(hsr_map.len(), 28);
        assert_eq!(
            hash(&serde_json::to_vec(&gi_map).unwrap()),
            GI_CANONICAL_SHA256
        );
        assert_eq!(
            hash(&serde_json::to_vec(&hsr_map).unwrap()),
            HSR_CANONICAL_SHA256
        );
        assert_eq!(GI_SOURCE_SHA256.len(), 64);
        assert_eq!(HSR_SOURCE_SHA256.len(), 64);
        assert_eq!(STARDB_SOURCE_COMMIT.len(), 40);
    }

    #[test]
    fn embedded_parser_rsa_keys_match_the_pinned_upstream_source() {
        fn lf(bytes: &[u8]) -> Vec<u8> {
            String::from_utf8(bytes.to_vec())
                .unwrap()
                .replace("\r\n", "\n")
                .into_bytes()
        }
        let key4 = include_bytes!("../vendor/auto-artifactarium/keys/private_key_4.pem");
        let key5 = include_bytes!("../vendor/auto-artifactarium/keys/private_key_5.pem");
        assert_eq!(
            hash(&lf(key4)),
            "c43fafade9dbc63440339fab24fa19d5ae78bc69e60d66ee956d951d6ff6392f"
        );
        assert_eq!(
            hash(&lf(key5)),
            "6a3fbd53387f9d13230f8558e40df18ad3a8fc11fc23da83a202eedc3bd70ce3"
        );
        fn der(bytes: &[u8]) -> Vec<u8> {
            let encoded = String::from_utf8(bytes.to_vec())
                .unwrap()
                .lines()
                .filter(|line| !line.starts_with("-----"))
                .collect::<String>();
            BASE64_STANDARD.decode(encoded).unwrap()
        }
        assert_eq!(
            hash(&der(key4)),
            "e27f729e1944a7550b51d27b3c3bf4b680209cb982413d3245d56df2ae7f0602"
        );
        assert_eq!(
            hash(&der(key5)),
            "b4ab7873b89540628de48a250747d0746f3c76e64a17b77dad221578a60fd996"
        );
    }
}
