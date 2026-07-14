use crate::Game;
use std::time::Duration;

#[derive(Debug, Eq, PartialEq)]
pub struct Options {
    pub game: Game,
    pub timeout: Duration,
}

pub enum Action {
    Run(Options),
    Help,
    Version,
}

pub fn parse<I, S>(arguments: I) -> Result<Action, String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut values = arguments.into_iter().map(Into::into);
    let mut game = None;
    let mut timeout = Duration::from_secs(180);
    while let Some(argument) = values.next() {
        match argument.as_str() {
            "--help" | "-h" => return Ok(Action::Help),
            "--version" | "-V" => return Ok(Action::Version),
            "--game" => {
                if game.is_some() {
                    return Err("--game was supplied twice".into());
                }
                game = Some(match values.next().as_deref() {
                    Some("gi") => Game::Gi,
                    Some("hsr") => Game::Hsr,
                    _ => return Err("--game must be gi or hsr".into()),
                });
            }
            "--timeout-seconds" => {
                let seconds = values
                    .next()
                    .ok_or("--timeout-seconds needs a number")?
                    .parse::<u64>()
                    .map_err(|_| "--timeout-seconds needs a number")?;
                if !(30..=300).contains(&seconds) {
                    return Err("--timeout-seconds must be from 30 to 300".into());
                }
                timeout = Duration::from_secs(seconds);
            }
            _ => return Err(format!("unknown option: {argument}")),
        }
    }
    let game = game.ok_or("--game is required (gi or hsr)")?;
    Ok(Action::Run(Options { game, timeout }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_safe_defaults_and_explicit_values() {
        let Action::Run(defaults) = parse(["--game", "gi"]).unwrap() else {
            panic!("expected run");
        };
        assert_eq!(defaults.game, Game::Gi);
        assert_eq!(defaults.timeout, Duration::from_secs(180));

        let Action::Run(custom) = parse(["--game", "hsr", "--timeout-seconds", "30"]).unwrap()
        else {
            panic!("expected run");
        };
        assert_eq!(custom.game, Game::Hsr);
        assert_eq!(custom.timeout, Duration::from_secs(30));
    }

    #[test]
    fn rejects_missing_duplicate_and_unknown_options() {
        assert!(parse::<_, String>([]).is_err());
        assert!(parse(["--game", "zzz"]).is_err());
        assert!(parse(["--game", "gi", "--game", "hsr"]).is_err());
        assert!(parse(["--game", "gi", "--wat"]).is_err());
        assert!(parse(["--game", "gi", "--output", "mine.json"]).is_err());
        assert!(parse(["--game", "gi", "--force"]).is_err());
        assert!(parse(["--game", "gi", "--timeout-seconds", "301"]).is_err());
    }
}
