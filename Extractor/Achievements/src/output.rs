use crate::Game;
use std::{
    ffi::OsStr,
    fmt,
    fs::{File, OpenOptions},
    io::Write,
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    path::{Path, PathBuf},
};
use windows::{
    Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_LIST_DIRECTORY,
            FILE_SHARE_READ, FILE_SHARE_WRITE, FlushFileBuffers, GetDriveTypeW, GetFileAttributesW,
            GetFileInformationByHandle, INVALID_FILE_ATTRIBUTES, MOVEFILE_WRITE_THROUGH,
            MoveFileExW,
        },
        System::Com::CoTaskMemFree,
        UI::Shell::{FOLDERID_LocalAppData, KF_FLAG_DEFAULT, SHGetKnownFolderPath},
    },
    core::PCWSTR,
};

const DRIVE_FIXED: u32 = 3;

#[derive(Debug)]
pub enum OutputError {
    UnsafeLocation,
    Exists,
    Io(std::io::Error),
}

impl fmt::Display for OutputError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsafeLocation => {
                write!(formatter, "the protected local export folder is unsafe")
            }
            Self::Exists => write!(
                formatter,
                "an export already exists; move or delete it before trying again"
            ),
            Self::Io(_) => write!(
                formatter,
                "the protected local JSON could not be written safely"
            ),
        }
    }
}

impl std::error::Error for OutputError {}

impl From<std::io::Error> for OutputError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub fn export_bytes(game: Game, ids: &[u32]) -> Vec<u8> {
    let values = ids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    format!("{{\"{}_achievements\":[{}]}}\n", game.key(), values).into_bytes()
}

fn wide(value: &OsStr) -> Result<Vec<u16>, OutputError> {
    let encoded = value.encode_wide().collect::<Vec<_>>();
    if encoded.contains(&0) {
        return Err(OutputError::UnsafeLocation);
    }
    Ok(encoded.into_iter().chain([0]).collect())
}

fn local_app_data() -> Result<PathBuf, OutputError> {
    unsafe {
        let value = SHGetKnownFolderPath(&FOLDERID_LocalAppData, KF_FLAG_DEFAULT, HANDLE(0))
            .map_err(|error| OutputError::Io(error.into()))?;
        let decoded = value.to_string();
        CoTaskMemFree(Some(value.0.cast()));
        decoded
            .map(PathBuf::from)
            .map_err(|_| OutputError::UnsafeLocation)
    }
}

fn require_fixed_volume(path: &Path) -> Result<(), OutputError> {
    let root = path.ancestors().last().ok_or(OutputError::UnsafeLocation)?;
    if root.as_os_str().is_empty() {
        return Err(OutputError::UnsafeLocation);
    }
    let root = wide(root.as_os_str())?;
    if unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) } != DRIVE_FIXED {
        return Err(OutputError::UnsafeLocation);
    }
    Ok(())
}

fn attributes(path: &Path) -> Result<u32, OutputError> {
    let value = wide(path.as_os_str())?;
    let result = unsafe { GetFileAttributesW(PCWSTR(value.as_ptr())) };
    if result == INVALID_FILE_ATTRIBUTES {
        return Err(OutputError::Io(std::io::Error::last_os_error()));
    }
    Ok(result)
}

fn require_plain_directory(path: &Path) -> Result<(), OutputError> {
    let value = attributes(path)?;
    if value & FILE_ATTRIBUTE_DIRECTORY.0 == 0 || value & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err(OutputError::UnsafeLocation);
    }
    Ok(())
}

fn require_plain_ancestors(path: &Path) -> Result<(), OutputError> {
    for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        require_plain_directory(ancestor)?;
    }
    Ok(())
}

fn ensure_plain_directory(path: &Path) -> Result<(), OutputError> {
    match std::fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(OutputError::Io(error)),
    }
    require_plain_directory(path)
}

fn hold_directory(path: &Path) -> Result<File, OutputError> {
    let handle = OpenOptions::new()
        .access_mode(FILE_LIST_DIRECTORY.0)
        .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    let ok = unsafe {
        GetFileInformationByHandle(HANDLE(handle.as_raw_handle() as isize), &mut information)
            .as_bool()
    };
    if !ok
        || information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0 == 0
        || information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
    {
        return Err(OutputError::UnsafeLocation);
    }
    Ok(handle)
}

fn secure_export_directory(base: &Path) -> Result<(PathBuf, File), OutputError> {
    require_fixed_volume(base)?;
    require_plain_ancestors(base)?;
    let pengo = base.join("Pengo");
    ensure_plain_directory(&pengo)?;
    let exports = pengo.join("Exports");
    ensure_plain_directory(&exports)?;
    let handle = hold_directory(&exports)?;
    Ok((exports, handle))
}

struct TempGuard(PathBuf);

impl Drop for TempGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn write_export_at(base: &Path, game: Game, ids: &[u32]) -> Result<PathBuf, OutputError> {
    let (directory, _held_directory) = secure_export_directory(base)?;
    let destination = directory.join(format!("pengo-achievements-{}.json", game.key()));
    match std::fs::symlink_metadata(&destination) {
        Ok(_) => return Err(OutputError::Exists),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(OutputError::Io(error)),
    }

    let temporary = tempfile::Builder::new()
        .prefix(".pengo-achievements-")
        .suffix(".tmp")
        .tempfile_in(&directory)?;
    let mut temporary = temporary;
    temporary.write_all(&export_bytes(game, ids))?;
    temporary.flush()?;
    if !unsafe { FlushFileBuffers(HANDLE(temporary.as_file().as_raw_handle() as isize)).as_bool() }
    {
        return Err(OutputError::Io(std::io::Error::last_os_error()));
    }
    let (_file, temporary_path) = temporary
        .keep()
        .map_err(|error| OutputError::Io(error.error))?;
    drop(_file);
    let mut cleanup = TempGuard(temporary_path);
    let from = wide(cleanup.0.as_os_str())?;
    let to = wide(destination.as_os_str())?;
    if !unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )
        .as_bool()
    } {
        let error = std::io::Error::last_os_error();
        return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
            OutputError::Exists
        } else {
            OutputError::Io(error)
        });
    }
    cleanup.0 = PathBuf::new();
    Ok(destination)
}

pub fn write_export(game: Game, ids: &[u32]) -> Result<PathBuf, OutputError> {
    write_export_at(&local_app_data()?, game, ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_json_is_bomless() {
        assert_eq!(
            export_bytes(Game::Gi, &[10, 20]),
            b"{\"gi_achievements\":[10,20]}\n"
        );
    }

    #[test]
    fn fixed_local_export_refuses_overwrite_and_leaves_no_temp() {
        let base = tempfile::tempdir().unwrap();
        let output = write_export_at(base.path(), Game::Gi, &[20]).unwrap();
        assert_eq!(
            std::fs::read(&output).unwrap(),
            export_bytes(Game::Gi, &[20])
        );
        assert!(matches!(
            write_export_at(base.path(), Game::Gi, &[30]),
            Err(OutputError::Exists)
        ));
        let entries = std::fs::read_dir(output.parent().unwrap())
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn rejects_non_fixed_and_reparse_locations() {
        assert!(matches!(
            require_fixed_volume(Path::new(r"\\server\share")),
            Err(OutputError::UnsafeLocation)
        ));
        let container = tempfile::tempdir().unwrap();
        let real = container.path().join("real");
        let linked = container.path().join("linked");
        std::fs::create_dir(&real).unwrap();
        if std::os::windows::fs::symlink_dir(&real, &linked).is_ok() {
            assert!(matches!(
                secure_export_directory(&linked),
                Err(OutputError::UnsafeLocation)
            ));
        }
    }

    #[test]
    fn abandoned_temporary_file_is_cleaned() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("orphan.tmp");
        std::fs::write(&path, b"not an export").unwrap();
        drop(TempGuard(path.clone()));
        assert!(!path.exists());
    }
}
